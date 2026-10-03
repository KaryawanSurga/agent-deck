import { describe, expect, it } from "vitest";
import { liveStatus } from "../src/core/status.js";
import type { Session } from "../src/core/store.js";

function session(status: Session["status"], lastOutputAt: string): Session {
  return {
    id: "s",
    agent: "a",
    command: ["node"],
    cwd: ".",
    startedAt: lastOutputAt,
    lastOutputAt,
    status,
    bytes: 1,
  };
}

describe("liveStatus", () => {
  const now = Date.parse("2026-10-03T00:00:10.000Z");

  it("keeps active sessions running and stale ones idle", () => {
    expect(liveStatus(session("running", "2026-10-03T00:00:09.500Z"), 5000, now)).toBe("running");
    expect(liveStatus(session("running", "2026-10-03T00:00:01.000Z"), 5000, now)).toBe("idle");
  });

  it("never changes terminal states", () => {
    expect(liveStatus(session("exited", "2026-10-03T00:00:01.000Z"), 0, now)).toBe("exited");
    expect(liveStatus(session("failed", "2026-10-03T00:00:01.000Z"), 0, now)).toBe("failed");
    expect(liveStatus(session("stopped", "2026-10-03T00:00:01.000Z"), 0, now)).toBe("stopped");
  });

  it("treats unparsable timestamps as running", () => {
    expect(liveStatus(session("running", "not-a-date"), 0, now)).toBe("running");
  });
});
