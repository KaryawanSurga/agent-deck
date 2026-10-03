import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { AgentSpec, DeckConfig } from "./config.js";
import { DeckEvents } from "./events.js";
import { liveStatus } from "./status.js";
import { SessionStore, type Session, type SessionStatus } from "./store.js";

export interface DeckSession extends Session {
  liveStatus: SessionStatus;
}

export interface DeckManagerOptions {
  cwd?: string;
  persistIntervalMs?: number;
}

export class DeckManager {
  private sessions: Session[];
  private readonly children = new Map<string, ChildProcess>();
  readonly events: DeckEvents;
  private readonly now: () => number;
  private readonly persistIntervalMs: number;
  private lastPersist = 0;

  constructor(
    private readonly config: DeckConfig,
    private readonly store: SessionStore,
    events: DeckEvents = new DeckEvents(),
    private readonly options: DeckManagerOptions = {},
  ) {
    this.events = events;
    this.now = () => Date.now();
    this.persistIntervalMs = options.persistIntervalMs ?? 500;
    this.sessions = store.load();

    let recovered = 0;
    const recoveredAt = new Date(this.now()).toISOString();
    for (const session of this.sessions) {
      if (session.status === "running" || session.status === "idle") {
        session.status = "stopped";
        session.endedAt = recoveredAt;
        session.signal = null;
        recovered += 1;
      }
    }
    if (recovered > 0) {
      this.persist(true);
    }
  }

  private persist(force = false): void {
    const now = this.now();
    if (!force && now - this.lastPersist < this.persistIntervalMs) {
      return;
    }
    this.lastPersist = now;
    this.store.save(this.sessions);
  }

  agents(): AgentSpec[] {
    return this.config.agents;
  }

  list(): DeckSession[] {
    const now = this.now();
    return [...this.sessions]
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .map((session) => ({ ...session, liveStatus: liveStatus(session, this.config.idleAfterMs, now) }));
  }

  find(id: string): DeckSession | undefined {
    const session = this.sessions.find((entry) => entry.id === id);
    if (session === undefined) {
      return undefined;
    }
    return { ...session, liveStatus: liveStatus(session, this.config.idleAfterMs, this.now()) };
  }

  start(agentName: string): DeckSession {
    const agent = this.config.agents.find((entry) => entry.name === agentName);
    if (agent === undefined) {
      throw new Error(
        `Unknown agent "${agentName}". Available: ${this.config.agents.map((entry) => entry.name).join(", ")}`,
      );
    }

    const startedAt = new Date(this.now()).toISOString();
    const id = `${agent.name}-${this.now().toString(36)}-${randomBytes(2).toString("hex")}`;
    const cwd = agent.cwd ?? this.options.cwd ?? process.cwd();
    const session: Session = {
      id,
      agent: agent.name,
      command: [agent.command, ...agent.args],
      cwd,
      startedAt,
      lastOutputAt: startedAt,
      status: "running",
      bytes: 0,
    };
    this.sessions.push(session);
    this.persist(true);

    const child = spawn(agent.command, agent.args, {
      cwd,
      env: { ...process.env, ...(agent.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.children.set(id, child);

    const onData = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      session.bytes += this.store.appendOutput(id, text);
      session.lastOutputAt = new Date(this.now()).toISOString();
      this.events.emit({ type: "output", sessionId: id, chunk: text });
      this.events.emit({ type: "session", session: { ...session } });
      this.persist();
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    child.on("error", (error) => {
      session.status = "failed";
      session.endedAt = new Date(this.now()).toISOString();
      this.store.appendOutput(id, `spawn error: ${error.message}\n`);
      this.children.delete(id);
      this.events.emit({ type: "session", session: { ...session } });
      this.persist(true);
    });

    child.on("exit", (code, signal) => {
      session.exitCode = code;
      session.signal = signal;
      session.endedAt = new Date(this.now()).toISOString();
      session.status = session.stoppedByUser === true ? "stopped" : code === 0 ? "exited" : "failed";
      this.children.delete(id);
      this.events.emit({ type: "session", session: { ...session } });
      this.persist(true);
    });

    this.events.emit({ type: "session", session: { ...session } });
    return { ...session, liveStatus: "running" };
  }

  stop(id: string): boolean {
    const session = this.sessions.find((entry) => entry.id === id);
    const child = this.children.get(id);
    if (session === undefined || child === undefined) {
      return false;
    }
    session.stoppedByUser = true;
    this.kill(child);
    return true;
  }

  logTail(id: string, maxLines?: number): string {
    return this.store.readTail(id, maxLines);
  }

  close(): void {
    for (const [id, child] of [...this.children.entries()]) {
      const session = this.sessions.find((entry) => entry.id === id);
      if (session !== undefined) {
        session.stoppedByUser = true;
      }
      this.kill(child);
    }
    this.children.clear();
  }

  private kill(child: ChildProcess): void {
    if (child.pid === undefined) {
      return;
    }
    if (process.platform === "win32") {
      execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => undefined);
      return;
    }
    child.kill("SIGTERM");
  }
}
