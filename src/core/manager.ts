import { randomBytes } from "node:crypto";
import type { AgentSpec, DeckConfig } from "./config.js";
import { DeckEvents } from "./events.js";
import { notifyTerminal } from "./notify.js";
import { spawnPty } from "./pty.js";
import { liveStatus } from "./status.js";
import { SessionStore, type Session, type SessionStatus, type SessionTransport } from "./store.js";
import { spawnPipe, type AgentProcess, type SpawnSpec, type TransportKind } from "./transport.js";

export interface DeckSession extends Session {
  liveStatus: SessionStatus;
}

export interface DeckManagerOptions {
  cwd?: string;
  persistIntervalMs?: number;
  notifyUrl?: string;
  onNotifyError?: (message: string) => void;
}

export interface StartOptions {
  transport?: TransportKind;
}

export interface SessionExport {
  session: Session;
  log: string;
}

export class DeckManager {
  private sessions: Session[];
  private readonly processes = new Map<string, AgentProcess>();
  readonly events: DeckEvents;
  private readonly now: () => number;
  private readonly persistIntervalMs: number;
  private readonly notifyUrl?: string;
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
    this.notifyUrl = options.notifyUrl ?? config.notifyUrl;
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

  async start(agentName: string, startOptions: StartOptions = {}): Promise<DeckSession> {
    const agent = this.config.agents.find((entry) => entry.name === agentName);
    if (agent === undefined) {
      throw new Error(
        `Unknown agent "${agentName}". Available: ${this.config.agents.map((entry) => entry.name).join(", ")}`,
      );
    }

    const startedAt = new Date(this.now()).toISOString();
    const id = `${agent.name}-${this.now().toString(36)}-${randomBytes(2).toString("hex")}`;
    const cwd = agent.cwd ?? this.options.cwd ?? process.cwd();
    const transport: SessionTransport = startOptions.transport ?? (agent.pty === true ? "pty" : "pipe");
    const session: Session = {
      id,
      agent: agent.name,
      command: [agent.command, ...agent.args],
      cwd,
      startedAt,
      lastOutputAt: startedAt,
      status: "running",
      bytes: 0,
      transport,
    };
    this.sessions.push(session);
    this.persist(true);

    const spec: SpawnSpec = {
      command: agent.command,
      args: agent.args,
      cwd,
      env: this.buildEnv(agent),
    };

    let child: AgentProcess;
    try {
      child = transport === "pty" ? await spawnPty(spec) : spawnPipe(spec);
    } catch (error) {
      this.markFailed(session, error instanceof Error ? error.message : String(error));
      return { ...session, liveStatus: "failed" };
    }
    this.processes.set(id, child);

    child.onOutput((text) => {
      session.bytes += this.store.appendOutput(id, text);
      session.lastOutputAt = new Date(this.now()).toISOString();
      this.events.emit({ type: "output", sessionId: id, chunk: text });
      this.events.emit({ type: "session", session: { ...session } });
      this.persist();
    });

    child.onError((error) => {
      this.markFailed(session, `spawn error: ${error.message}`);
    });

    child.onExit((code, signal) => {
      session.exitCode = code;
      session.signal = signal;
      session.endedAt = new Date(this.now()).toISOString();
      session.status = session.stoppedByUser === true ? "stopped" : code === 0 ? "exited" : "failed";
      this.processes.delete(id);
      this.events.emit({ type: "session", session: { ...session } });
      this.persist(true);
      this.notify(session);
    });

    this.events.emit({ type: "session", session: { ...session } });
    return { ...session, liveStatus: "running" };
  }

  private buildEnv(agent: AgentSpec): Record<string, string> {
    const merged: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...process.env, ...(agent.env ?? {}) })) {
      if (typeof value === "string") {
        merged[key] = value;
      }
    }
    return merged;
  }

  private markFailed(session: Session, message: string): void {
    session.status = "failed";
    session.endedAt = new Date(this.now()).toISOString();
    session.signal = null;
    this.processes.delete(session.id);
    this.store.appendOutput(session.id, `${message}\n`);
    this.events.emit({ type: "session", session: { ...session } });
    this.persist(true);
    this.notify(session);
  }

  private notify(session: Session): void {
    if (this.notifyUrl === undefined) {
      return;
    }
    void notifyTerminal(this.notifyUrl, { ...session }).then((delivered) => {
      if (!delivered) {
        this.options.onNotifyError?.(`webhook notification failed for session ${session.id}`);
      }
    });
  }

  stop(id: string): boolean {
    const session = this.sessions.find((entry) => entry.id === id);
    const child = this.processes.get(id);
    if (session === undefined || child === undefined) {
      return false;
    }
    session.stoppedByUser = true;
    child.kill();
    return true;
  }

  logTail(id: string, maxLines?: number): string {
    return this.store.readTail(id, maxLines);
  }

  prune(days: number): string[] {
    const cutoff = this.now() - days * 24 * 60 * 60 * 1000;
    const removed: string[] = [];
    const kept: Session[] = [];
    for (const session of this.sessions) {
      const running = session.status === "running" || session.status === "idle";
      if (running || Date.parse(session.startedAt) >= cutoff) {
        kept.push(session);
      } else {
        removed.push(session.id);
      }
    }
    if (removed.length > 0) {
      this.sessions = kept;
      for (const id of removed) {
        this.store.removeLog(id);
      }
      this.persist(true);
    }
    return removed;
  }

  export(id: string): SessionExport {
    const session = this.sessions.find((entry) => entry.id === id);
    if (session === undefined) {
      throw new Error(`Unknown session "${id}"`);
    }
    return { session: { ...session }, log: this.store.readTail(id, 1000) };
  }

  close(): void {
    for (const [id, child] of [...this.processes.entries()]) {
      const session = this.sessions.find((entry) => entry.id === id);
      if (session !== undefined) {
        session.stoppedByUser = true;
      }
      child.kill();
    }
    this.processes.clear();
  }
}
