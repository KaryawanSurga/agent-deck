import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_SESSIONS, SessionStore, type Session } from "../src/core/store.js";
import { cleanup, makeTempDir } from "./helpers/deck.js";

function session(id: string, startedAt: string): Session {
  return {
    id,
    agent: "demo",
    command: ["node", "-e", "1"],
    cwd: ".",
    startedAt,
    lastOutputAt: startedAt,
    status: "exited",
    bytes: 0,
  };
}

describe("SessionStore", () => {
  it("saves and loads sessions", async () => {
    const dir = await makeTempDir();
    try {
      const store = new SessionStore(path.join(dir, ".agent-deck"));
      store.save([session("a", "2026-10-03T00:00:00Z"), session("b", "2026-10-03T00:01:00Z")]);
      const loaded = store.load();
      expect(loaded.map((entry) => entry.id)).toEqual(["a", "b"]);
    } finally {
      await cleanup(dir);
    }
  });

  it("caps the stored history", async () => {
    const dir = await makeTempDir();
    try {
      const store = new SessionStore(path.join(dir, ".agent-deck"));
      const sessions: Session[] = [];
      for (let index = 0; index < MAX_SESSIONS + 10; index += 1) {
        sessions.push(session(`s${index}`, new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()));
      }
      store.save(sessions);
      const loaded = store.load();
      expect(loaded).toHaveLength(MAX_SESSIONS);
      expect(loaded[0]?.id).toBe("s10");
    } finally {
      await cleanup(dir);
    }
  });

  it("appends output and reads tails", async () => {
    const dir = await makeTempDir();
    try {
      const store = new SessionStore(path.join(dir, ".agent-deck"));
      for (let index = 1; index <= 20; index += 1) {
        store.appendOutput("run-1", `line ${index}\n`);
      }
      const tail = store.readTail("run-1", 5);
      expect(tail.split("\n")).toEqual(["line 16", "line 17", "line 18", "line 19", "line 20"]);
      expect(store.readTail("missing")).toBe("");
    } finally {
      await cleanup(dir);
    }
  });

  it("drops the partial first line when reading a global byte tail", async () => {
    const dir = await makeTempDir();
    try {
      const store = new SessionStore(path.join(dir, ".agent-deck"));
      const chunk = `${"x".repeat(600)}\n`;
      for (let index = 0; index < 1000; index += 1) {
        store.appendOutput("big", `line-${index}-${chunk}`);
      }
      const tail = store.readTail("big", 3);
      const lines = tail.split("\n");
      expect(lines).toHaveLength(3);
      expect(lines[0]?.startsWith("line-")).toBe(true);
    } finally {
      await cleanup(dir);
    }
  });

  it("tolerates a corrupted index", async () => {
    const dir = await makeTempDir();
    try {
      const store = new SessionStore(path.join(dir, ".agent-deck"));
      store.save([session("a", "2026-10-03T00:00:00Z")]);
      const { writeFileSync } = await import("node:fs");
      writeFileSync(store.sessionsFile, "{ broken", "utf8");
      expect(store.load()).toEqual([]);
    } finally {
      await cleanup(dir);
    }
  });
});
