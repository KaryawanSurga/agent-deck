import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SessionStore } from "../src/core/store.js";
import { cleanup, makeConfig, makeManager, makeTempDir, nodeCommand } from "./helpers/deck.js";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("manager.prune", () => {
  it("removes old sessions and their logs, keeping recent ones", async () => {
    const dir = await makeTempDir();
    try {
      const stateDir = path.join(dir, ".agent-deck");
      const store = new SessionStore(stateDir);
      const now = Date.now();
      const oldIso = new Date(now - 30 * DAY_MS).toISOString();
      const recentIso = new Date(now - 1 * DAY_MS).toISOString();
      store.save([
        {
          id: "old",
          agent: "ticker",
          command: ["node"],
          cwd: ".",
          startedAt: oldIso,
          endedAt: oldIso,
          lastOutputAt: oldIso,
          status: "exited",
          bytes: 8,
        },
        {
          id: "recent",
          agent: "ticker",
          command: ["node"],
          cwd: ".",
          startedAt: recentIso,
          endedAt: recentIso,
          lastOutputAt: recentIso,
          status: "exited",
          bytes: 8,
        },
      ]);
      store.appendOutput("old", "old log\n");
      store.appendOutput("recent", "recent log\n");

      const config = makeConfig({ ticker: nodeCommand("ticker.mjs") });
      const { manager } = makeManager(config, dir);
      const removed = manager.prune(7);

      expect(removed).toEqual(["old"]);
      expect(manager.find("old")).toBeUndefined();
      expect(manager.find("recent")).toBeDefined();
      expect(existsSync(store.logPath("old"))).toBe(false);
      expect(existsSync(store.logPath("recent"))).toBe(true);
    } finally {
      await cleanup(dir);
    }
  });

  it("removes nothing when every session is recent", async () => {
    const dir = await makeTempDir();
    try {
      const stateDir = path.join(dir, ".agent-deck");
      const store = new SessionStore(stateDir);
      const recentIso = new Date(Date.now() - 2 * DAY_MS).toISOString();
      store.save([
        {
          id: "recent",
          agent: "ticker",
          command: ["node"],
          cwd: ".",
          startedAt: recentIso,
          endedAt: recentIso,
          lastOutputAt: recentIso,
          status: "exited",
          bytes: 8,
        },
      ]);

      const config = makeConfig({ ticker: nodeCommand("ticker.mjs") });
      const { manager } = makeManager(config, dir);
      expect(manager.prune(7)).toEqual([]);
      expect(manager.find("recent")).toBeDefined();
    } finally {
      await cleanup(dir);
    }
  });
});
