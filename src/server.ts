import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { DeckConfig } from "./core/config.js";
import type { DeckManager } from "./core/manager.js";
import { renderDashboardHtml } from "./dashboard.js";

export const DEFAULT_PORT = 8787;
export const DEFAULT_HOST = "127.0.0.1";
export const MAX_BODY_BYTES = 64 * 1024;
export const DEFAULT_LOG_TAIL = 200;

export interface DeckServerOptions {
  manager: DeckManager;
  config: DeckConfig;
  host?: string;
  port?: number;
}

export interface DeckServerInstance {
  host: string;
  port: number;
  url: string;
  close: () => Promise<void>;
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.trim().length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    request.on("error", reject);
  });
}

export async function startDeckServer(options: DeckServerOptions): Promise<DeckServerInstance> {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const { manager, config } = options;

  const sendJson = (response: ServerResponse, status: number, payload: unknown): void => {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(payload, null, 2));
  };

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`);

    try {
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/dashboard")) {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(renderDashboardHtml());
        return;
      }

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { status: "ok", sessions: manager.list().length });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/agents") {
        sendJson(response, 200, { agents: config.agents });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/sessions") {
        sendJson(response, 200, { sessions: manager.list() });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/sessions") {
        let body: unknown;
        try {
          body = await readJsonBody(request);
        } catch (error) {
          sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
          return;
        }
        const agent =
          body !== null && typeof body === "object" && !Array.isArray(body)
            ? (body as Record<string, unknown>)["agent"]
            : undefined;
        if (typeof agent !== "string" || agent.length === 0) {
          sendJson(response, 400, { error: 'Body must be {"agent": "<name>"}' });
          return;
        }
        try {
          const session = manager.start(agent);
          sendJson(response, 201, { session });
        } catch (error) {
          sendJson(response, 404, { error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }

      const action = /^\/api\/sessions\/([^/]+)\/(stop|log)$/.exec(url.pathname);
      if (action !== null) {
        const id = decodeURIComponent(action[1] ?? "");
        const kind = action[2];
        const session = manager.find(id);
        if (session === undefined) {
          sendJson(response, 404, { error: `Unknown session "${id}"` });
          return;
        }
        if (kind === "stop" && request.method === "POST") {
          const stopped = manager.stop(id);
          if (!stopped) {
            sendJson(response, 409, { error: "Session is not running in this process" });
            return;
          }
          sendJson(response, 200, { stopped: true });
          return;
        }
        if (kind === "log" && request.method === "GET") {
          const parsedTail = Number.parseInt(url.searchParams.get("tail") ?? String(DEFAULT_LOG_TAIL), 10);
          const tail = Number.isFinite(parsedTail) && parsedTail > 0 ? parsedTail : DEFAULT_LOG_TAIL;
          sendJson(response, 200, { session, log: manager.logTail(id, tail) });
          return;
        }
      }

      if (request.method === "GET" && url.pathname === "/api/events") {
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        response.write(`event: snapshot\ndata: ${JSON.stringify({ sessions: manager.list() })}\n\n`);

        const unsubscribe = manager.events.subscribe((event) => {
          if (event.type === "output") {
            response.write(`event: output\ndata: ${JSON.stringify({ sessionId: event.sessionId, chunk: event.chunk })}\n\n`);
          } else {
            response.write(`event: session\ndata: ${JSON.stringify(event.session)}\n\n`);
          }
        });
        const keepAlive = setInterval(() => {
          response.write(": keep-alive\n\n");
        }, 15000);
        request.on("close", () => {
          clearInterval(keepAlive);
          unsubscribe();
        });
        return;
      }

      sendJson(response, 404, { error: `Not found: ${request.method ?? "?"} ${url.pathname}` });
    } catch (error) {
      if (!response.headersSent) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
      } else {
        response.end();
      }
    }
  };

  const server = createServer((request, response) => {
    void handle(request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;

  return {
    host,
    port: actualPort,
    url: `http://${host}:${actualPort}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
