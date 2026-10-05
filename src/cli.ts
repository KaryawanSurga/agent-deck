import { promises as fs } from "node:fs";
import { parseArgs } from "node:util";
import {
  defaultConfig,
  loadConfig,
  resolveConfigPath,
  serializeConfig,
} from "./core/config.js";
import { DeckManager } from "./core/manager.js";
import { SessionStore, DEFAULT_PRUNE_DAYS, DEFAULT_TAIL_LINES } from "./core/store.js";
import type { SessionTransport } from "./core/store.js";
import { startDeckServer, DEFAULT_HOST, DEFAULT_PORT } from "./server.js";

export const VERSION = "0.2.0";

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  color: boolean;
}

export const HELP = `agent-deck ${VERSION}

Local mission control for long-running agent jobs.

Usage:
  agent-deck init [--force] [--config <path>]
  agent-deck list [--json] [--config <path>]
  agent-deck run <agent> [--pty] [--config <path>]
  agent-deck logs <session-id> [--tail <n>] [--state <dir>]
  agent-deck export <session-id> [--out <path>] [--config <path>]
  agent-deck prune [--days <n>] [--config <path>]
  agent-deck serve [--port <n>] [--host <h>] [--config <path>]
  agent-deck --help | --version

Commands:
  init    Write a starter config with a demo agent
  list    Show configured agents and recent sessions
  run     Start an agent and stream its output here
  logs    Print a session's log tail
  export  Print a session with its log as JSON
  prune   Delete sessions and logs older than N days
  serve   Start the live dashboard in a browser

Options:
  --config <path>   Config file (default ./agent-deck.json)
  --state <dir>     Session state directory (default ./.agent-deck)
  --port <n>        Dashboard port (default ${DEFAULT_PORT})
  --host <h>        Dashboard host (default ${DEFAULT_HOST})
  --tail <n>        Lines for logs (default ${DEFAULT_TAIL_LINES})
  --days <n>        Prune age in days (default ${DEFAULT_PRUNE_DAYS})
  --out <path>      Write export JSON to a file
  --pty             Force a pty session for run
  --json            Machine-readable output for list
  --force           Overwrite the config on init
  -h, --help        Show this help
  -v, --version     Print the version

Exit codes: 0 ok, 1 agent failed or a file problem, 2 usage error.
`;

function parsePositiveInt(value: unknown, flag: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export async function main(argv: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      config: { type: "string" },
      state: { type: "string" },
      port: { type: "string" },
      host: { type: "string" },
      tail: { type: "string" },
      days: { type: "string" },
      out: { type: "string" },
      json: { type: "boolean" },
      force: { type: "boolean" },
      pty: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });

  const { values, positionals } = parsed;
  const command = positionals[0];

  if (values["version"] === true) {
    io.stdout(VERSION);
    return 0;
  }
  if (values["help"] === true || command === undefined || command === "help") {
    io.stdout(HELP);
    return 0;
  }

  if (!["init", "list", "run", "logs", "serve", "prune", "export"].includes(command)) {
    io.stderr(`Unknown command: ${command}`);
    io.stderr("Run agent-deck --help for usage.");
    return 2;
  }

  const cwd = process.cwd();
  const explicitConfig = typeof values["config"] === "string" ? values["config"] : undefined;
  const configPath = resolveConfigPath(cwd, explicitConfig);
  const stateDir = typeof values["state"] === "string" ? values["state"] : undefined;
  const store = new SessionStore(stateDir);

  if (command === "init") {
    if ((await fileExists(configPath)) && values["force"] !== true) {
      io.stderr(`Config already exists: ${configPath} (use --force to overwrite)`);
      return 1;
    }
    try {
      await fs.writeFile(configPath, serializeConfig(defaultConfig()), "utf8");
      io.stdout(`Created ${configPath}`);
      io.stdout("Start the demo agent with: agent-deck run demo");
      return 0;
    } catch (error) {
      io.stderr(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }

  if (command === "logs") {
    const sessionId = positionals[1];
    if (sessionId === undefined) {
      io.stderr("logs requires a session id");
      return 2;
    }
    try {
      const tail = parsePositiveInt(values["tail"], "--tail", DEFAULT_TAIL_LINES);
      const log = store.readTail(sessionId, tail);
      if (log.length === 0) {
        io.stderr(`No log found for session "${sessionId}" in ${store.logsDir}`);
        return 1;
      }
      io.stdout(log);
      return 0;
    } catch (error) {
      io.stderr(error instanceof Error ? error.message : String(error));
      return 2;
    }
  }

  if (command === "serve") {
    let config;
    try {
      config = await loadConfig(configPath);
    } catch (error) {
      io.stderr(error instanceof Error ? error.message : String(error));
      return 1;
    }
    let port = DEFAULT_PORT;
    let host = DEFAULT_HOST;
    try {
      port = parsePositiveInt(values["port"], "--port", DEFAULT_PORT);
      if (typeof values["host"] === "string") {
        host = values["host"];
      }
    } catch (error) {
      io.stderr(error instanceof Error ? error.message : String(error));
      return 2;
    }

    const manager = new DeckManager(config, store, undefined, {
      onNotifyError: (message) => io.stderr(message),
    });
    const instance = await startDeckServer({ manager, config, host, port });
    io.stdout(`Agent Deck dashboard: ${instance.url}`);
    io.stdout(`  health: ${instance.url}/health`);
    io.stdout(`  events: ${instance.url}/api/events`);

    const shutdown = (): void => {
      manager.close();
      void instance.close().finally(() => process.exit(0));
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    return 0;
  }

  if (command === "run" && positionals[1] === undefined) {
    io.stderr("run requires an agent name. See `agent-deck list`.");
    return 2;
  }

  // Commands below need a valid config.
  let config;
  try {
    config = await loadConfig(configPath);
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (command === "list") {
    const manager = new DeckManager(config, store);
    const sessions = manager.list();
    if (values["json"] === true) {
      io.stdout(JSON.stringify({ configPath, agents: config.agents, sessions }, null, 2));
      return 0;
    }
    io.stdout(`Config: ${configPath}`);
    io.stdout("");
    io.stdout("Agents:");
    for (const agent of config.agents) {
      const description = agent.description !== undefined ? ` — ${agent.description}` : "";
      io.stdout(`  ${agent.name}: ${agent.command} ${agent.args.join(" ")}${description}`.trimEnd());
    }
    io.stdout("");
    io.stdout(`Sessions (${sessions.length}):`);
    if (sessions.length === 0) {
      io.stdout("  (none)");
    }
    for (const session of sessions.slice(0, 10)) {
      const exit = session.exitCode !== undefined && session.exitCode !== null ? ` exit=${session.exitCode}` : "";
      io.stdout(
        `  ${session.id}  [${session.liveStatus}]  ${new Date(session.startedAt).toLocaleString()}  ${formatBytes(session.bytes)}${exit}`,
      );
    }
    return 0;
  }

  if (command === "prune") {
    let days: number;
    try {
      days = parsePositiveInt(values["days"], "--days", DEFAULT_PRUNE_DAYS);
    } catch (error) {
      io.stderr(error instanceof Error ? error.message : String(error));
      return 2;
    }
    const manager = new DeckManager(config, store);
    const removed = manager.prune(days);
    io.stdout(`Pruned ${removed.length} session(s) older than ${days} day(s).`);
    for (const id of removed) {
      io.stdout(`  ${id}`);
    }
    return 0;
  }

  if (command === "export") {
    const sessionId = positionals[1];
    if (sessionId === undefined) {
      io.stderr("export requires a session id");
      return 2;
    }
    const manager = new DeckManager(config, store);
    let payload;
    try {
      payload = manager.export(sessionId);
    } catch (error) {
      io.stderr(error instanceof Error ? error.message : String(error));
      return 1;
    }
    const text = `${JSON.stringify(payload, null, 2)}\n`;
    const outPath = typeof values["out"] === "string" ? values["out"] : undefined;
    if (outPath === undefined) {
      io.stdout(text);
      return 0;
    }
    try {
      await fs.writeFile(outPath, text, "utf8");
      io.stdout(`Wrote ${outPath}`);
      return 0;
    } catch (error) {
      io.stderr(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }

  if (command === "run") {
    const agentName = positionals[1] as string;
    const transport: SessionTransport | undefined = values["pty"] === true ? "pty" : undefined;
    const manager = new DeckManager(config, store, undefined, {
      onNotifyError: (message) => io.stderr(message),
    });
    return await new Promise<number>(async (resolve) => {
      let targetId: string | undefined;
      let finished = false;

      const finish = (code: number): void => {
        if (finished) {
          return;
        }
        finished = true;
        unsubscribe();
        manager.close();
        resolve(code);
      };

      const unsubscribe = manager.events.subscribe((event) => {
        if (targetId === undefined) {
          return;
        }
        if (event.type === "output" && event.sessionId === targetId) {
          io.stdout(event.chunk);
          return;
        }
        if (
          event.type === "session" &&
          event.session.id === targetId &&
          event.session.status !== "running" &&
          event.session.status !== "idle"
        ) {
          const session = event.session;
          io.stdout(
            `[${session.status}] exit=${session.exitCode ?? "null"}${session.signal !== undefined && session.signal !== null ? ` signal=${session.signal}` : ""} bytes=${session.bytes}`,
          );
          finish(session.status === "exited" ? 0 : 1);
        }
      });

      try {
        const session = await manager.start(agentName, { transport });
        targetId = session.id;
        io.stderr(`session ${session.id} started`);
      } catch (error) {
        io.stderr(error instanceof Error ? error.message : String(error));
        unsubscribe();
        manager.close();
        finish(2);
      }
    });
  }

  io.stderr(`Unknown command: ${command}`);
  io.stderr("Run agent-deck --help for usage.");
  return 2;
}
