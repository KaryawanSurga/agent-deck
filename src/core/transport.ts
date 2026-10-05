import { execFile, spawn, type ChildProcess } from "node:child_process";

export type TransportKind = "pipe" | "pty";

export interface SpawnSpec {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface AgentProcess {
  readonly pid: number | undefined;
  onOutput(callback: (chunk: string) => void): void;
  onExit(callback: (code: number | null, signal: string | null) => void): void;
  onError(callback: (error: Error) => void): void;
  kill(): void;
}

export function spawnPipe(spec: SpawnSpec): AgentProcess {
  const child: ChildProcess = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  return {
    pid: child.pid,
    onOutput(callback) {
      child.stdout?.on("data", (chunk: Buffer) => callback(chunk.toString("utf8")));
      child.stderr?.on("data", (chunk: Buffer) => callback(chunk.toString("utf8")));
    },
    onExit(callback) {
      child.on("exit", (code, signal) => callback(code, signal));
    },
    onError(callback) {
      child.on("error", (error) => callback(error));
    },
    kill() {
      if (child.pid === undefined) {
        return;
      }
      if (process.platform === "win32") {
        execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => undefined);
        return;
      }
      child.kill("SIGTERM");
    },
  };
}
