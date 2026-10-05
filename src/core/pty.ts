import type { AgentProcess, SpawnSpec } from "./transport.js";

interface PtyProcessLike {
  pid: number;
  onData: (callback: (data: string) => void) => void;
  onExit: (callback: (event: { exitCode: number; signal?: number }) => void) => void;
  kill: () => void;
}

interface PtyModuleLike {
  spawn: (
    file: string,
    args: string[] | string,
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: Record<string, string>;
    },
  ) => PtyProcessLike;
}

const MODULE_NAME = "@homebridge/node-pty-prebuilt-multiarch";

let loader: Promise<PtyModuleLike | undefined> | undefined;

export function loadPty(): Promise<PtyModuleLike | undefined> {
  loader ??= import(MODULE_NAME)
    .then((module) => module as unknown as PtyModuleLike)
    .catch(() => undefined);
  return loader;
}

export function spawnPty(spec: SpawnSpec): Promise<AgentProcess> {
  return loadPty().then((pty) => {
    if (pty === undefined) {
      throw new Error(
        "PTY sessions need the optional package @homebridge/node-pty-prebuilt-multiarch. Install it with: npm install @homebridge/node-pty-prebuilt-multiarch",
      );
    }
    const proc = pty.spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      cols: 120,
      rows: 30,
    });
    return {
      pid: proc.pid,
      onOutput(callback) {
        proc.onData(callback);
      },
      onExit(callback) {
        proc.onExit(({ exitCode, signal }) => callback(exitCode, signal === undefined ? null : String(signal)));
      },
      onError() {
        // pty.spawn throws synchronously on failure; there is no async error channel.
      },
      kill() {
        try {
          proc.kill();
        } catch {
          // Process already gone.
        }
      },
    };
  });
}
