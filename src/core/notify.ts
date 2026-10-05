import type { Session } from "./store.js";

export interface NotifyOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function terminalPayload(session: Session): Record<string, unknown> {
  return {
    event: "session",
    id: session.id,
    agent: session.agent,
    status: session.status,
    exitCode: session.exitCode ?? null,
    signal: session.signal ?? null,
    transport: session.transport ?? "pipe",
    startedAt: session.startedAt,
    endedAt: session.endedAt ?? null,
    bytes: session.bytes,
  };
}

export async function notifyTerminal(url: string, session: Session, options: NotifyOptions = {}): Promise<boolean> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(terminalPayload(session)),
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
