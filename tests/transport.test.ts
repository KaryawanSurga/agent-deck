import { describe, expect, it } from "vitest";
import { spawnPipe } from "../src/core/transport.js";
import { fixture } from "./helpers/deck.js";

describe("spawnPipe", () => {
  it("streams output and reports the exit code", async () => {
    const chunks: string[] = [];
    const result = await new Promise<{ code: number | null }>((resolve) => {
      const proc = spawnPipe({
        command: process.execPath,
        args: [fixture("ticker.mjs")],
        cwd: process.cwd(),
        env: {},
      });
      proc.onOutput((chunk) => chunks.push(chunk));
      proc.onExit((code) => resolve({ code }));
    });
    expect(result.code).toBe(0);
    expect(chunks.join("")).toContain("tick 5");
  });

  it("kills a running process on request", async () => {
    const code = await new Promise<number | null>((resolve) => {
      const proc = spawnPipe({
        command: process.execPath,
        args: [fixture("sleeper.mjs")],
        cwd: process.cwd(),
        env: {},
      });
      proc.onExit((exitCode) => resolve(exitCode));
      setTimeout(() => proc.kill(), 150);
    });
    expect(code === null || code !== 0).toBe(true);
  });
});
