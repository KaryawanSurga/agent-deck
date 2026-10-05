import { describe, expect, it } from "vitest";
import { loadPty, spawnPty } from "../src/core/pty.js";
import { fixture } from "./helpers/deck.js";

const ptyAvailable = (await loadPty()) !== undefined;

const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (typeof value === "string") {
    env[key] = value;
  }
}

describe.skipIf(!ptyAvailable)("spawnPty", () => {
  it("streams output through a pty and reports the exit code", async () => {
    const chunks: string[] = [];
    const proc = await spawnPty({
      command: process.execPath,
      args: [fixture("ticker.mjs")],
      cwd: process.cwd(),
      env,
    });
    const code = await new Promise<number | null>((resolve) => {
      proc.onOutput((chunk) => chunks.push(chunk));
      proc.onExit((exitCode) => resolve(exitCode));
    });
    expect(code).toBe(0);
    expect(chunks.join("")).toContain("tick 5");
  });

  it("kills a pty process on request", async () => {
    const proc = await spawnPty({
      command: process.execPath,
      args: [fixture("sleeper.mjs")],
      cwd: process.cwd(),
      env,
    });
    let requested = false;
    const exitedAfterKill = await new Promise<boolean>((resolve) => {
      proc.onExit(() => resolve(requested));
      setTimeout(() => {
        requested = true;
        proc.kill();
      }, 150);
    });
    expect(exitedAfterKill).toBe(true);
  });
});
