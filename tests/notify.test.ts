import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { notifyTerminal, terminalPayload } from "../src/core/notify.js";
import type { Session } from "../src/core/store.js";
import { cleanup, makeConfig, makeManager, makeTempDir, nodeCommand, waitFor } from "./helpers/deck.js";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "demo-1",
    agent: "demo",
    command: ["node", "-e", "process.exit(2)"],
    cwd: ".",
    startedAt: "2026-10-05T00:00:00.000Z",
    endedAt: "2026-10-05T00:00:01.000Z",
    exitCode: 2,
    signal: null,
    status: "failed",
    bytes: 12,
    lastOutputAt: "2026-10-05T00:00:01.000Z",
    transport: "pty",
    ...overrides,
  };
}

interface Capture {
  url: string;
  next: Promise<unknown>;
  close: () => Promise<void>;
}

async function startCapture(status = 200, respond = true): Promise<Capture> {
  let resolveNext!: (body: unknown) => void;
  const next = new Promise<unknown>((resolve) => {
    resolveNext = resolve;
  });
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      resolveNext(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (respond) {
        response.writeHead(status, { "content-type": "application/json" });
        response.end("{}");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/hook`,
    next,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

describe("notifyTerminal", () => {
  it("posts the terminal session payload", async () => {
    const capture = await startCapture(200);
    try {
      const delivered = await notifyTerminal(capture.url, makeSession());
      expect(delivered).toBe(true);
      const body = (await capture.next) as Record<string, unknown>;
      expect(body).toMatchObject({
        event: "session",
        id: "demo-1",
        agent: "demo",
        status: "failed",
        exitCode: 2,
        transport: "pty",
      });
    } finally {
      await capture.close();
    }
  });

  it("reports failure for non-2xx responses", async () => {
    const capture = await startCapture(500);
    try {
      expect(await notifyTerminal(capture.url, makeSession())).toBe(false);
    } finally {
      await capture.close();
    }
  });

  it("reports failure for unreachable endpoints", async () => {
    expect(await notifyTerminal("http://127.0.0.1:1/hook", makeSession())).toBe(false);
  });

  it("gives up when the endpoint never responds", async () => {
    const capture = await startCapture(200, false);
    try {
      const delivered = await notifyTerminal(capture.url, makeSession(), { timeoutMs: 200 });
      expect(delivered).toBe(false);
      void capture.next;
    } finally {
      await capture.close();
    }
  });

  it("builds the payload with pipe as the default transport", () => {
    const payload = terminalPayload(makeSession({ transport: undefined }));
    expect(payload["transport"]).toBe("pipe");
  });

  it("fires from the manager when a session reaches a terminal state", async () => {
    const dir = await makeTempDir();
    const capture = await startCapture(200);
    try {
      const config = makeConfig({ failer: nodeCommand("failer.mjs") });
      config.notifyUrl = capture.url;
      const { manager, store } = makeManager(config, dir);
      const session = await manager.start("failer");
      const body = (await capture.next) as Record<string, unknown>;
      expect(body).toMatchObject({ id: session.id, agent: "failer", status: "failed", exitCode: 2 });
      await waitFor(() => manager.find(session.id)?.status === "failed");
      expect(store.readTail(session.id, 5)).toContain("boom");
      manager.close();
    } finally {
      await capture.close();
      await cleanup(dir);
    }
  });
});
