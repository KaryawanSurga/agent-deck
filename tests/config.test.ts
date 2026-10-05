import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultConfig,
  loadConfig,
  parseConfig,
  resolveConfigPath,
  serializeConfig,
  validateAgentName,
} from "../src/core/config.js";

describe("parseConfig", () => {
  it("parses agents and applies defaults", () => {
    const config = parseConfig({
      agents: {
        docs: { command: "node", args: ["docs.mjs"], description: "Docs worker" },
        build: { command: "make" },
      },
    });
    expect(config.idleAfterMs).toBe(5000);
    expect(config.agents.map((agent) => agent.name)).toEqual(["build", "docs"]);
    expect(config.agents[1]?.description).toBe("Docs worker");
    expect(config.agents[0]?.args).toEqual([]);
  });

  it("accepts a custom idle window", () => {
    expect(parseConfig({ idleAfterMs: 250, agents: { a: { command: "node" } } }).idleAfterMs).toBe(250);
  });

  it("parses pty agents and notify urls", () => {
    const config = parseConfig({
      notifyUrl: "https://hooks.example.test/agent-deck",
      agents: {
        repl: { command: "node", pty: true },
        job: { command: "node", pty: false },
      },
    });
    expect(config.notifyUrl).toBe("https://hooks.example.test/agent-deck");
    expect(config.agents.find((agent) => agent.name === "repl")?.pty).toBe(true);
    expect(config.agents.find((agent) => agent.name === "job")?.pty).toBeUndefined();
  });

  it("rejects invalid pty and notify settings", () => {
    expect(() => parseConfig({ agents: { a: { command: "node", pty: "yes" } } })).toThrow("pty must be a boolean");
    expect(() => parseConfig({ agents: { a: { command: "node" } }, notifyUrl: "ftp://nope" })).toThrow(
      '"notifyUrl" must be an http(s) URL string',
    );
  });

  it("rejects invalid documents", () => {
    expect(() => parseConfig(null)).toThrow("expected a JSON object");
    expect(() => parseConfig({ agents: [] })).toThrow('"agents" must be an object');
    expect(() => parseConfig({ agents: {} })).toThrow("no agents configured");
    expect(() => parseConfig({ agents: { "bad name": { command: "node" } } })).toThrow("Invalid agent name");
    expect(() => parseConfig({ agents: { a: {} } })).toThrow('needs a "command"');
    expect(() => parseConfig({ agents: { a: { command: "node", args: [1] } } })).toThrow("args must be an array");
    expect(() => parseConfig({ agents: { a: { command: "node", env: { X: 1 } } } })).toThrow("env must map strings");
    expect(() => parseConfig({ agents: { a: { command: "node" } }, idleAfterMs: -1 })).toThrow("non-negative");
  });

  it("validates agent names", () => {
    expect(() => validateAgentName("docs-worker_1")).not.toThrow();
    expect(() => validateAgentName("-nope")).toThrow();
  });
});

describe("config serialization", () => {
  it("round-trips through serialize and parse", () => {
    const config = defaultConfig();
    const parsed = parseConfig(JSON.parse(serializeConfig(config)));
    expect(parsed.agents[0]?.name).toBe("demo");
    expect(parsed.idleAfterMs).toBe(config.idleAfterMs);
  });

  it("round-trips pty and notify settings", () => {
    const config = parseConfig({
      notifyUrl: "http://127.0.0.1:9999/hook",
      agents: { repl: { command: "node", pty: true } },
    });
    const parsed = parseConfig(JSON.parse(serializeConfig(config)));
    expect(parsed.notifyUrl).toBe("http://127.0.0.1:9999/hook");
    expect(parsed.agents[0]?.pty).toBe(true);
  });

  it("loads from disk and reports problems", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agent-deck-config-"));
    try {
      const file = path.join(dir, "agent-deck.json");
      await writeFile(file, serializeConfig(defaultConfig()));
      expect((await loadConfig(file)).agents).toHaveLength(1);

      const broken = path.join(dir, "broken.json");
      await writeFile(broken, "{ nope");
      await expect(loadConfig(broken)).rejects.toThrow("not valid JSON");
      await expect(loadConfig(path.join(dir, "missing.json"))).rejects.toThrow("Config not found");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("resolves explicit and default config paths", () => {
    expect(resolveConfigPath("C:/work")).toContain("agent-deck.json");
    expect(resolveConfigPath("C:/work", "custom.json")).toContain("custom.json");
  });
});
