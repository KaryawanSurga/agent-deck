# PRD — Agent Deck

**Status:** v0.2.0 ready to ship
**Owner:** KaryawanSurga
**Last updated:** 2026-10-05

## 1. Summary

Agent Deck is local mission control for long-running agent jobs. It starts configured agents as child processes over pipe or PTY transports, streams their output to a live web dashboard over Server-Sent Events, reports live status (running, idle, exited, failed, stopped), notifies a webhook when runs end, and lets you stop runs. State lives in local files; required runtime dependencies are zero.

## 2. Problem

- Long agent runs are invisible until they finish or fail; failures are discovered late.
- Parallel jobs mean parallel terminals with no shared status, no history, and no standard way to stop a runaway process.
- Hosted agent dashboards require accounts, network exposure, or a platform.
- Existing process managers (pm2, systemd) are not built around agent-oriented views: output recency, idle detection, per-run logs.

## 3. Target users

- Developers running coding agents in print mode, test suites, and data jobs.
- Agent builders who need a local observability layer without a platform.
- Teams standardizing how agent jobs are launched and watched on a workstation.

## 4. Goals (v0.2.0)

1. Define agents in a simple JSON config and start them from CLI or dashboard.
2. Stream stdout/stderr live to a browser without external dependencies.
3. Report honest status: running, idle (silent longer than a window), exited, failed, stopped.
4. Persist sessions and logs locally; recover sessions left behind by a previous process.
5. Provide CLI parity: `init`, `list`, `run`, `logs`, `serve`.
6. Ship zero required runtime dependencies and bind to loopback by default.
7. Support PTY sessions through an optional package, with a clear failure mode and no impact on pipe agents.
8. Post a webhook payload when a session reaches a terminal state.
9. Provide maintenance commands: `export` a session with its log and `prune` old state.

## 5. Non-goals

- Multi-user access control, accounts, or remote exposure.
- Distributed scheduling or multi-machine orchestration (roadmap).
- Replacing CI systems or container orchestrators.
- Windows service installation.
- Retrying or guaranteeing webhook delivery in v0.2.0.

## 6. User stories

- As a developer, I start an agent and see its output live in a browser.
- As an operator, I want to stop a runaway agent from the same view.
- As a developer, I want to learn that a job failed without waiting at a terminal.
- As a team member, I want to see which jobs are running, idle, or finished on this machine.

## 7. Functional requirements

| ID | Requirement |
| --- | --- |
| FR1 | JSON config defines agents (command, args, cwd, env, description) and an idle window. |
| FR2 | `run <agent>` spawns the process, streams its output to the terminal, and mirrors the agent's outcome in the exit code. |
| FR3 | `serve` hosts a dashboard and API on loopback with a configurable port and host. |
| FR4 | Live output reaches the dashboard over Server-Sent Events with snapshot, session, and output events. |
| FR5 | Statuses: running, idle (output recency > idleAfterMs), exited (code 0), failed (non-zero or spawn error), stopped (killed or recovered). |
| FR6 | Sessions and per-session logs persist under `.agent-deck/`; history is capped at 100 sessions; tails are capped by lines and bytes. |
| FR7 | Sessions left running by a previous process are marked stopped at startup. |
| FR8 | Stopping kills the process tree (taskkill on Windows, SIGTERM elsewhere) and marks the session stopped. |
| FR9 | `list` and `logs` provide CLI access to agents, sessions, and log tails, with `--json` for `list`. |
| FR10 | The dashboard shows agents with start buttons, sessions with status dots, a live output pane, and stop buttons. |
| FR11 | `"pty": true` (config) or `--pty` (CLI) runs an agent through a pseudo-terminal when the optional package is installed; otherwise the session fails with an actionable message. |
| FR12 | `notifyUrl` receives a JSON POST with the session summary on exited, failed, and stopped transitions; delivery failures are reported without affecting the session. |
| FR13 | `export <session-id>` prints the session record and its log as JSON; `--out` writes it to a file. |
| FR14 | `prune [--days <n>]` deletes finished sessions and their logs older than the window and keeps running ones. |
| FR15 | Sessions record their transport, and the dashboard marks PTY sessions.

## 8. Non-functional requirements

- Zero required runtime dependencies; Node >= 20. PTY support is an optional dependency behind a single module.
- Local-only by default (`127.0.0.1`); no telemetry.
- Deterministic file formats: JSON session index written atomically (temp file + rename).
- Errors are returned as JSON with actionable messages; the dashboard never crashes the server.
- Webhook delivery is fire-and-forget with a 5-second timeout; sessions never block on it.
- Tests cover real child processes on both transports, the API, SSE, notifications, maintenance commands, and the CLI.

## 9. Success metrics

- Adoption as the default way to watch agent jobs on a workstation.
- Issues/PRs requesting PTY sessions, notifications, or worktrees (roadmap validation).
- npm installs and GitHub stars growing week over week.
- Mentions alongside agent CLI tools.

## 10. Technical notes

- `node:http` serves both the dashboard and SSE; no WebSocket layer.
- A spawn transport layer exposes one `AgentProcess` interface: `spawnPipe` (child_process, process-tree kill) and `spawnPty` (optional dynamic import, loaded on demand).
- `child_process.spawn` with piped stdio; output chunks are appended to per-session log files and broadcast to subscribers.
- Session index writes are throttled during streaming and forced on terminal state changes.
- Kill uses `taskkill /T /F` on Windows to reach `npx`-style process trees, SIGTERM elsewhere; PTY sessions kill through the PTY handle.
- Webhook notifications run through `notifyTerminal`, which never throws and returns delivery status.
- `prune` removes state files and logs while preserving running sessions.
- The dashboard uses textContent only, so process output can never inject markup into the page.

## 11. Release plan

- **v0.1.0** — config, run/list/logs/serve, dashboard, SSE, status, recovery (shipped 2026-10-03).
- **v0.2.0** — PTY sessions, webhook notifications, export, prune (shipped 2026-10-05).
- **v0.3.0** — worktree-per-session, task queue with gates, multi-machine agents over SSH.

## 12. Open questions

- Should idle detection also consider CPU activity, not only output recency?
- Should `stop` be exposed over a small local control file so any CLI process can stop dashboard-owned sessions?
- Should webhook delivery be retried with backoff, and should payload signing be supported?
- Should the dashboard allow sending input to PTY sessions, or stay read-only in v0.3?
