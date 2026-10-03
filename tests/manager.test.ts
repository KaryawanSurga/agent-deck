import { describe, expect, it } from "vitest";
import { DeckManager } from "../src/core/manager.js";
import { SessionStore } from "../src/core/store.js";
import path from "node:path";
import { cleanup, makeConfig, makeManager, makeTempDir, nodeCommand, waitFor } from "./helpers/deck.js";

describe("DeckManager", () => {
  it("runs an agent to completion and captures output", async () => {
    const dir = await makeTempDir();
    try {
      const config = makeConfig({ ticker: nodeCommand("ticker.mjs") });
      const { manager, store, events } = makeManager(config, dir);
      const chunks: string[] = [];
      events.subscribe((event) => {
        if (event.type === "output") {
          chunks.push(event.chunk);
        }
      });

      const session = manager.start("ticker");
      await waitFor(() => manager.find(session.id)?.status === "exited");

      const finished = manager.find(session.id);
      expect(finished?.exitCode).toBe(0);
      expect(finished?.bytes).toBeGreaterThan(0);
      expect(store.readTail(session.id, 10)).toContain("tick 5");
      expect(chunks.join("")).toContain("tick 1");
      manager.close();
    } finally {
      await cleanup(dir);
    }
  });

  it("marks non-zero exits as failed", async () => {
    const dir = await makeTempDir();
    try {
      const config = makeConfig({ failer: nodeCommand("failer.mjs") });
      const { manager, store } = makeManager(config, dir);
      const session = manager.start("failer");
      await waitFor(() => manager.find(session.id)?.status === "failed");
      expect(manager.find(session.id)?.exitCode).toBe(2);
      expect(store.readTail(session.id, 5)).toContain("boom");
      manager.close();
    } finally {
      await cleanup(dir);
    }
  });

  it("detects idle agents and stops them on request", async () => {
    const dir = await makeTempDir();
    try {
      const config = makeConfig({ sleeper: nodeCommand("sleeper.mjs") }, 150);
      const { manager } = makeManager(config, dir);
      const session = manager.start("sleeper");

      await waitFor(() => manager.find(session.id)?.liveStatus === "idle");
      expect(manager.stop(session.id)).toBe(true);
      await waitFor(() => manager.find(session.id)?.status === "stopped");
      expect(manager.stop(session.id)).toBe(false);
      manager.close();
    } finally {
      await cleanup(dir);
    }
  });

  it("rejects unknown agents", async () => {
    const dir = await makeTempDir();
    try {
      const config = makeConfig({ ticker: nodeCommand("ticker.mjs") });
      const { manager } = makeManager(config, dir);
      expect(() => manager.start("nope")).toThrow('Unknown agent "nope"');
      manager.close();
    } finally {
      await cleanup(dir);
    }
  });

  it("recovers sessions left behind by a previous run", async () => {
    const dir = await makeTempDir();
    try {
      const storeDir = path.join(dir, ".agent-deck");
      const store = new SessionStore(storeDir);
      store.save([
        {
          id: "old-run",
          agent: "ticker",
          command: ["node"],
          cwd: ".",
          startedAt: "2026-10-01T00:00:00Z",
          lastOutputAt: "2026-10-01T00:00:00Z",
          status: "running",
          bytes: 10,
        },
      ]);

      const config = makeConfig({ ticker: nodeCommand("ticker.mjs") });
      const manager = new DeckManager(config, new SessionStore(storeDir));
      const recovered = manager.find("old-run");
      expect(recovered?.status).toBe("stopped");
      expect(recovered?.endedAt).toBeDefined();
    } finally {
      await cleanup(dir);
    }
  });

  it("kills children when the manager closes", async () => {
    const dir = await makeTempDir();
    try {
      const config = makeConfig({ sleeper: nodeCommand("sleeper.mjs") });
      const { manager } = makeManager(config, dir);
      const session = manager.start("sleeper");
      await waitFor(() => manager.find(session.id) !== undefined);
      manager.close();
      await waitFor(() => manager.find(session.id)?.status === "stopped");
    } finally {
      await cleanup(dir);
    }
  });
});
