import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { main, type CliIo } from "../src/cli.js";
import { serializeConfig } from "../src/core/config.js";
import { cleanup, fixture, makeConfig, makeTempDir } from "./helpers/deck.js";

function makeIo(): { io: CliIo; out: () => string; err: () => string } {
  let out = "";
  let err = "";
  return {
    io: {
      stdout: (text) => {
        out += `${text}\n`;
      },
      stderr: (text) => {
        err += `${text}\n`;
      },
      color: false,
    },
    out: () => out,
    err: () => err,
  };
}

async function writeConfig(directory: string, agents: Parameters<typeof makeConfig>[0]): Promise<string> {
  const file = path.join(directory, "agent-deck.json");
  await writeFile(file, serializeConfig(makeConfig(agents, 5000)));
  return file;
}

describe("cli", () => {
  it("prints the version and help", async () => {
    const version = makeIo();
    expect(await main(["--version"], version.io)).toBe(0);
    expect(version.out()).toContain("0.1.0");

    const help = makeIo();
    expect(await main([], help.io)).toBe(0);
    expect(help.out()).toContain("Usage:");
  });

  it("inits a config and protects it", async () => {
    const dir = await makeTempDir();
    try {
      const configPath = path.join(dir, "agent-deck.json");
      const first = makeIo();
      expect(await main(["init", "--config", configPath], first.io)).toBe(0);
      expect(JSON.parse(await readFile(configPath, "utf8"))).toHaveProperty("agents.demo");

      const again = makeIo();
      expect(await main(["init", "--config", configPath], again.io)).toBe(1);

      const forced = makeIo();
      expect(await main(["init", "--config", configPath, "--force"], forced.io)).toBe(0);
    } finally {
      await cleanup(dir);
    }
  });

  it("lists agents and sessions as json", async () => {
    const dir = await makeTempDir();
    try {
      const configPath = await writeConfig(dir, { ticker: { command: process.execPath, args: [fixture("ticker.mjs")] } });
      const { io, out } = makeIo();
      const code = await main(["list", "--config", configPath, "--state", path.join(dir, ".agent-deck"), "--json"], io);
      expect(code).toBe(0);
      const payload = JSON.parse(out()) as { agents: Array<{ name: string }>; sessions: unknown[] };
      expect(payload.agents[0]?.name).toBe("ticker");
      expect(payload.sessions).toEqual([]);
    } finally {
      await cleanup(dir);
    }
  });

  it("runs an agent and streams its output", async () => {
    const dir = await makeTempDir();
    try {
      const configPath = await writeConfig(dir, { ticker: { command: process.execPath, args: [fixture("ticker.mjs")] } });
      const { io, out, err } = makeIo();
      const code = await main(["run", "ticker", "--config", configPath, "--state", path.join(dir, ".agent-deck")], io);
      expect(code).toBe(0);
      expect(out()).toContain("tick 5");
      expect(out()).toContain("[exited] exit=0");
      const sessionId = /session (\S+) started/.exec(err())?.[1];
      expect(sessionId).toBeDefined();
    } finally {
      await cleanup(dir);
    }
  });

  it("exits 1 when an agent fails", async () => {
    const dir = await makeTempDir();
    try {
      const configPath = await writeConfig(dir, { failer: { command: process.execPath, args: [fixture("failer.mjs")] } });
      const { io, out } = makeIo();
      const code = await main(["run", "failer", "--config", configPath, "--state", path.join(dir, ".agent-deck")], io);
      expect(code).toBe(1);
      expect(out()).toContain("[failed] exit=2");
    } finally {
      await cleanup(dir);
    }
  });

  it("rejects unknown agents and reads logs", async () => {
    const dir = await makeTempDir();
    try {
      const stateDir = path.join(dir, ".agent-deck");
      const configPath = await writeConfig(dir, { ticker: { command: process.execPath, args: [fixture("ticker.mjs")] } });

      const unknown = makeIo();
      expect(await main(["run", "nope", "--config", configPath, "--state", stateDir], unknown.io)).toBe(2);
      expect(unknown.err()).toContain('Unknown agent "nope"');

      const run = makeIo();
      await main(["run", "ticker", "--config", configPath, "--state", stateDir], run.io);
      const sessionId = /session (\S+) started/.exec(run.err())?.[1];
      expect(sessionId).toBeDefined();

      const logs = makeIo();
      expect(await main(["logs", sessionId ?? "", "--state", stateDir, "--tail", "3"], logs.io)).toBe(0);
      expect(logs.out()).toContain("tick 5");

      const missing = makeIo();
      expect(await main(["logs", "no-such-session", "--state", stateDir], missing.io)).toBe(1);
      expect(missing.err()).toContain("No log found");
    } finally {
      await cleanup(dir);
    }
  });

  it("reports usage and config problems", async () => {
    const noConfig = makeIo();
    expect(await main(["list", "--config", "definitely/missing.json"], noConfig.io)).toBe(1);
    expect(noConfig.err()).toContain("Config not found");

    const noAgent = makeIo();
    expect(await main(["run"], noAgent.io)).toBe(2);
    expect(noAgent.err()).toContain("run requires an agent name");

    const unknown = makeIo();
    expect(await main(["bogus"], unknown.io)).toBe(2);
    expect(unknown.err()).toContain("Unknown command");
  });
});
