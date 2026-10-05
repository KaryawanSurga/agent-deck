import { promises as fs } from "node:fs";
import path from "node:path";

export const CONFIG_FILENAME = "agent-deck.json";
export const DEFAULT_IDLE_AFTER_MS = 5000;

export interface AgentSpec {
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  description?: string;
  pty?: boolean;
}

export interface DeckConfig {
  agents: AgentSpec[];
  idleAfterMs: number;
  notifyUrl?: string;
}

export function defaultConfig(): DeckConfig {
  return {
    agents: [
      {
        name: "demo",
        command: "node",
        args: ["-e", "let i=0;setInterval(()=>console.log('tick',++i),1000)"],
        description: "Demo ticker that prints a line every second.",
      },
    ],
    idleAfterMs: DEFAULT_IDLE_AFTER_MS,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateAgentName(name: string): void {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) {
    throw new Error(`Invalid agent name "${name}": use letters, digits, dashes, and underscores`);
  }
}

function parseAgent(entry: unknown, name: string, source: string): AgentSpec {
  validateAgentName(name);
  if (!isRecord(entry)) {
    throw new Error(`${source}: agent "${name}" must be an object`);
  }
  const command = entry["command"];
  if (typeof command !== "string" || command.length === 0) {
    throw new Error(`${source}: agent "${name}" needs a "command" string`);
  }
  const rawArgs = entry["args"];
  let args: string[] = [];
  if (rawArgs !== undefined) {
    if (!Array.isArray(rawArgs) || rawArgs.some((value) => typeof value !== "string")) {
      throw new Error(`${source}: agent "${name}" args must be an array of strings`);
    }
    args = rawArgs as string[];
  }
  const spec: AgentSpec = { name, command, args };
  if (typeof entry["cwd"] === "string" && entry["cwd"].length > 0) {
    spec.cwd = entry["cwd"];
  }
  const rawEnv = entry["env"];
  if (rawEnv !== undefined) {
    if (!isRecord(rawEnv) || Object.values(rawEnv).some((value) => typeof value !== "string")) {
      throw new Error(`${source}: agent "${name}" env must map strings to strings`);
    }
    spec.env = rawEnv as Record<string, string>;
  }
  if (typeof entry["description"] === "string" && entry["description"].length > 0) {
    spec.description = entry["description"];
  }
  const rawPty = entry["pty"];
  if (rawPty !== undefined) {
    if (typeof rawPty !== "boolean") {
      throw new Error(`${source}: agent "${name}" pty must be a boolean`);
    }
    if (rawPty) {
      spec.pty = true;
    }
  }
  return spec;
}

export function parseConfig(raw: unknown, source = "config"): DeckConfig {
  if (!isRecord(raw)) {
    throw new Error(`${source}: expected a JSON object`);
  }
  const rawAgents = raw["agents"];
  if (rawAgents !== undefined && !isRecord(rawAgents)) {
    throw new Error(`${source}: "agents" must be an object keyed by agent name`);
  }

  const agents: AgentSpec[] = [];
  for (const [name, entry] of Object.entries(rawAgents ?? {})) {
    agents.push(parseAgent(entry, name, source));
  }
  if (agents.length === 0) {
    throw new Error(`${source}: no agents configured`);
  }
  agents.sort((left, right) => left.name.localeCompare(right.name));

  const rawIdle = raw["idleAfterMs"];
  let idleAfterMs = DEFAULT_IDLE_AFTER_MS;
  if (rawIdle !== undefined) {
    if (typeof rawIdle !== "number" || !Number.isFinite(rawIdle) || rawIdle < 0) {
      throw new Error(`${source}: "idleAfterMs" must be a non-negative number`);
    }
    idleAfterMs = rawIdle;
  }

  const config: DeckConfig = { agents, idleAfterMs };
  const rawNotify = raw["notifyUrl"];
  if (rawNotify !== undefined) {
    if (
      typeof rawNotify !== "string" ||
      !(rawNotify.startsWith("http://") || rawNotify.startsWith("https://"))
    ) {
      throw new Error(`${source}: "notifyUrl" must be an http(s) URL string`);
    }
    config.notifyUrl = rawNotify;
  }
  return config;
}

export function serializeConfig(config: DeckConfig): string {
  const agents: Record<string, unknown> = {};
  for (const agent of config.agents) {
    const entry: Record<string, unknown> = { command: agent.command, args: agent.args };
    if (agent.cwd !== undefined) {
      entry["cwd"] = agent.cwd;
    }
    if (agent.env !== undefined) {
      entry["env"] = agent.env;
    }
    if (agent.description !== undefined) {
      entry["description"] = agent.description;
    }
    if (agent.pty === true) {
      entry["pty"] = true;
    }
    agents[agent.name] = entry;
  }
  const raw: Record<string, unknown> = { idleAfterMs: config.idleAfterMs, agents };
  if (config.notifyUrl !== undefined) {
    raw["notifyUrl"] = config.notifyUrl;
  }
  return `${JSON.stringify(raw, null, 2)}\n`;
}

export function resolveConfigPath(cwd: string, explicit?: string): string {
  return path.resolve(cwd, explicit ?? CONFIG_FILENAME);
}

export async function loadConfig(filePath: string): Promise<DeckConfig> {
  const resolved = path.resolve(filePath);
  const text = await fs.readFile(resolved, "utf8").catch(() => undefined);
  if (text === undefined) {
    throw new Error(`Config not found: ${resolved}. Run "agent-deck init" first.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Config is not valid JSON: ${resolved}`);
  }
  return parseConfig(parsed, resolved);
}
