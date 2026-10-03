import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDeckServer, type DeckServerInstance } from "../src/server.js";
import { cleanup, makeConfig, makeManager, makeTempDir, nodeCommand, waitFor } from "./helpers/deck.js";

let directory: string;
let instance: DeckServerInstance;
let manager: ReturnType<typeof makeManager>["manager"];

beforeAll(async () => {
  directory = await makeTempDir();
  const config = makeConfig(
    {
      ticker: nodeCommand("ticker.mjs"),
      sleeper: nodeCommand("sleeper.mjs"),
    },
    150,
  );
  const made = makeManager(config, directory);
  manager = made.manager;
  instance = await startDeckServer({ manager, config, port: 0 });
});

afterAll(async () => {
  manager.close();
  await instance.close();
  await cleanup(directory);
});

describe("deck server", () => {
  it("serves health and the dashboard", async () => {
    const health = await fetch(`${instance.url}/health`);
    expect(health.status).toBe(200);
    expect((await health.json()) as { status: string }).toMatchObject({ status: "ok" });

    const page = await fetch(`${instance.url}/`);
    expect(page.headers.get("content-type")).toContain("text/html");
    const html = await page.text();
    expect(html).toContain("Agent Deck");
    expect(html).toContain("/api/events");
  });

  it("lists agents and sessions", async () => {
    const agents = (await (await fetch(`${instance.url}/api/agents`)).json()) as {
      agents: Array<{ name: string }>;
    };
    expect(agents.agents.map((agent) => agent.name)).toEqual(["sleeper", "ticker"]);

    const sessions = (await (await fetch(`${instance.url}/api/sessions`)).json()) as { sessions: unknown[] };
    expect(Array.isArray(sessions.sessions)).toBe(true);
  });

  it("starts a session, tails its log, and sees it finish", async () => {
    const response = await fetch(`${instance.url}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "ticker" }),
    });
    expect(response.status).toBe(201);
    const started = (await response.json()) as { session: { id: string } };

    await waitFor(() => manager.find(started.session.id)?.status === "exited");

    const log = (await (await fetch(`${instance.url}/api/sessions/${started.session.id}/log?tail=10`)).json()) as {
      log: string;
    };
    expect(log.log).toContain("tick 5");
  });

  it("stops running sessions and reports conflicts", async () => {
    const started = (await (
      await fetch(`${instance.url}/api/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent: "sleeper" }),
      })
    ).json()) as { session: { id: string } };

    const stop = await fetch(`${instance.url}/api/sessions/${started.session.id}/stop`, { method: "POST" });
    expect(stop.status).toBe(200);
    await waitFor(() => manager.find(started.session.id)?.status === "stopped");

    const again = await fetch(`${instance.url}/api/sessions/${started.session.id}/stop`, { method: "POST" });
    expect(again.status).toBe(409);
  });

  it("rejects bad requests", async () => {
    const badBody = await fetch(`${instance.url}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(badBody.status).toBe(400);

    const badJson = await fetch(`${instance.url}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ nope",
    });
    expect(badJson.status).toBe(400);

    const unknownAgent = await fetch(`${instance.url}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "nope" }),
    });
    expect(unknownAgent.status).toBe(404);

    const unknownSession = await fetch(`${instance.url}/api/sessions/nope/log`);
    expect(unknownSession.status).toBe(404);

    const notFound = await fetch(`${instance.url}/nope`);
    expect(notFound.status).toBe(404);
  });

  it("streams events over server-sent events", async () => {
    const controller = new AbortController();
    const response = await fetch(`${instance.url}/api/events`, { signal: controller.signal });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body?.getReader();
    if (reader === undefined) {
      throw new Error("no response body");
    }

    await fetch(`${instance.url}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "ticker" }),
    });

    const decoder = new TextDecoder();
    let buffer = "";
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done === true) {
        break;
      }
      buffer += decoder.decode(value);
      if (buffer.includes("event: snapshot") && buffer.includes("event: output") && buffer.includes("tick")) {
        break;
      }
    }

    controller.abort();
    await reader.cancel().catch(() => undefined);
    expect(buffer).toContain("event: snapshot");
    expect(buffer).toContain("event: output");
    expect(buffer).toContain("tick");
  });
});
