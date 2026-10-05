import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, openSync, readSync, closeSync } from "node:fs";
import path from "node:path";

export type SessionStatus = "running" | "idle" | "exited" | "failed" | "stopped";
export type SessionTransport = "pipe" | "pty";

export interface Session {
  id: string;
  agent: string;
  command: string[];
  cwd: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
  status: SessionStatus;
  bytes: number;
  lastOutputAt: string;
  stoppedByUser?: boolean;
  transport?: SessionTransport;
}

export const DEFAULT_STATE_DIR = ".agent-deck";
export const MAX_SESSIONS = 100;
export const MAX_TAIL_BYTES = 512 * 1024;
export const DEFAULT_TAIL_LINES = 200;
export const DEFAULT_PRUNE_DAYS = 7;

export class SessionStore {
  readonly rootDir: string;
  readonly sessionsFile: string;
  readonly logsDir: string;

  constructor(rootDir: string = DEFAULT_STATE_DIR) {
    this.rootDir = path.resolve(rootDir);
    this.sessionsFile = path.join(this.rootDir, "sessions.json");
    this.logsDir = path.join(this.rootDir, "logs");
  }

  load(): Session[] {
    if (!existsSync(this.sessionsFile)) {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.sessionsFile, "utf8"));
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter((entry): entry is Session => entry !== null && typeof entry === "object");
    } catch {
      return [];
    }
  }

  save(sessions: Session[]): void {
    mkdirSync(this.rootDir, { recursive: true });
    const trimmed = [...sessions]
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
      .slice(-MAX_SESSIONS);
    const temporary = `${this.sessionsFile}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(trimmed, null, 2)}\n`, "utf8");
    renameSync(temporary, this.sessionsFile);
  }

  logPath(sessionId: string): string {
    return path.join(this.logsDir, `${sessionId}.log`);
  }

  appendOutput(sessionId: string, chunk: string): number {
    mkdirSync(this.logsDir, { recursive: true });
    appendFileSync(this.logPath(sessionId), chunk, "utf8");
    return Buffer.byteLength(chunk, "utf8");
  }

  readTail(sessionId: string, maxLines: number = DEFAULT_TAIL_LINES): string {
    const file = this.logPath(sessionId);
    if (!existsSync(file)) {
      return "";
    }
    const size = statSync(file).size;
    const start = Math.max(0, size - MAX_TAIL_BYTES);
    const length = size - start;
    let content = "";
    if (length > 0) {
      const descriptor = openSync(file, "r");
      try {
        const buffer = Buffer.alloc(length);
        readSync(descriptor, buffer, 0, length, start);
        content = buffer.toString("utf8");
      } finally {
        closeSync(descriptor);
      }
    }
    if (start > 0) {
      const firstNewline = content.indexOf("\n");
      content = firstNewline === -1 ? content : content.slice(firstNewline + 1);
    }
    const lines = content.split(/\r\n|\r|\n/);
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    return lines.slice(-maxLines).join("\n");
  }

  removeOutput(sessionId: string): void {
    const file = this.logPath(sessionId);
    if (existsSync(file)) {
      writeFileSync(file, "", "utf8");
    }
  }

  removeLog(sessionId: string): void {
    const file = this.logPath(sessionId);
    try {
      unlinkSync(file);
    } catch {
      // No log to remove.
    }
  }
}
