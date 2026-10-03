import type { Session, SessionStatus } from "./store.js";

/**
 * Sessions keep their stored status once they end. While a process is alive,
 * the live status distinguishes active output from an idle agent that has
 * stopped writing for longer than the configured window.
 */
export function liveStatus(session: Session, idleAfterMs: number, now: number = Date.now()): SessionStatus {
  if (session.status !== "running") {
    return session.status;
  }
  const lastOutput = Date.parse(session.lastOutputAt);
  if (!Number.isFinite(lastOutput)) {
    return "running";
  }
  return now - lastOutput > idleAfterMs ? "idle" : "running";
}
