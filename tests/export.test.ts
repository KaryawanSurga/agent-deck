import { describe, expect, it } from "vitest";
import { cleanup, makeConfig, makeManager, makeTempDir, nodeCommand, waitFor } from "./helpers/deck.js";

describe("manager.export", () => {
  it("returns the session record together with its log", async () => {
    const dir = await makeTempDir();
    try {
      const config = makeConfig({ ticker: nodeCommand("ticker.mjs") });
      const { manager } = makeManager(config, dir);
      const session = await manager.start("ticker");
      await waitFor(() => manager.find(session.id)?.status === "exited");

      const payload = manager.export(session.id);
      expect(payload.session.id).toBe(session.id);
      expect(payload.session.status).toBe("exited");
      expect(payload.session.exitCode).toBe(0);
      expect(payload.log).toContain("tick 5");
      manager.close();
    } finally {
      await cleanup(dir);
    }
  });

  it("rejects unknown session ids", async () => {
    const dir = await makeTempDir();
    try {
      const config = makeConfig({ ticker: nodeCommand("ticker.mjs") });
      const { manager } = makeManager(config, dir);
      expect(() => manager.export("nope")).toThrow('Unknown session "nope"');
      manager.close();
    } finally {
      await cleanup(dir);
    }
  });
});
