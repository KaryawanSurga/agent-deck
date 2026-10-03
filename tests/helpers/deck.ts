import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseConfig, type DeckConfig } from "../../src/core/config.js";
import { DeckEvents } from "../../src/core/events.js";
import { DeckManager } from "../../src/core/manager.js";
import { SessionStore } from "../../src/core/store.js";

export const fixturesDir = fileURLToPath(new URL("../fixtures", import.meta.url));

export function fixture(name: string): string {
  return path.join(fixturesDir, name);
}

export async function makeTempDir(prefix = "agent-deck-"): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

export async function cleanup(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}

export interface AgentInput {
  command: string;
  args?: string[];
  description?: string;
}

export function makeConfig(agents: Record<string, AgentInput>, idleAfterMs = 5000): DeckConfig {
  const entries: Record<string, Record<string, unknown>> = {};
  for (const [name, spec] of Object.entries(agents)) {
    const entry: Record<string, unknown> = { command: spec.command, args: spec.args ?? [] };
    if (spec.description !== undefined) {
      entry["description"] = spec.description;
    }
    entries[name] = entry;
  }
  return parseConfig({ idleAfterMs, agents: entries });
}

export function makeManager(
  config: DeckConfig,
  directory: string,
): { manager: DeckManager; store: SessionStore; events: DeckEvents } {
  const store = new SessionStore(path.join(directory, ".agent-deck"));
  const events = new DeckEvents();
  const manager = new DeckManager(config, store, events);
  return { manager, store, events };
}

export async function waitFor(predicate: () => boolean, timeoutMs = 10000, interval = 25): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error("Timed out waiting for condition");
}

export function nodeCommand(script: string): AgentInput {
  return { command: process.execPath, args: [fixture(script)] };
}
