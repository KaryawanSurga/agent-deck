# Changelog

All notable changes to Agent Deck are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-10-05

### Added

- PTY sessions: set `"pty": true` on an agent or pass `--pty` to `run` and the process gets a real pseudo-terminal. Backed by the optional `@homebridge/node-pty-prebuilt-multiarch` package with a clear error when it is missing.
- Webhook notifications: `notifyUrl` posts a JSON payload with the session summary whenever a run reaches a terminal state (exited, failed, stopped).
- `agent-deck export <session-id>` prints a session record and its log as JSON, with `--out` to write a file.
- `agent-deck prune [--days <n>]` deletes finished sessions and their logs older than N days (default 7).
- Sessions record their transport, and the dashboard shows a `pty` badge.
- A spawn transport layer: pipe and PTY backends behind one `AgentProcess` interface.

### Changed

- `DeckManager.start` is now async (transport loading and future remote backends).
- The README, PRDs, example config, and architecture notes cover the v0.2 surface.

## [0.1.0] - 2026-10-03

### Added

- `agent-deck init`: write a starter config with a demo agent.
- `agent-deck run <agent>`: start a configured agent and stream its output to the terminal.
- `agent-deck list`, `logs`, and `stop` for session management.
- `agent-deck serve`: local web dashboard with live session output over Server-Sent Events.
- Dashboard API: agents, sessions, session start/stop, log tails, health, and an event stream.
- Session store with per-session log files, a session index, and a bounded history.
- Idle detection based on output recency, plus terminal states for exited, failed, and stopped runs.
- Recovery of sessions left behind by a previous run.
- Zero runtime dependencies: Node's HTTP, child process, and file system modules only.
- Unit, integration, dashboard API, and CLI test coverage.

[0.1.0]: https://github.com/KaryawanSurga/agent-deck/releases/tag/v0.1.0
[0.2.0]: https://github.com/KaryawanSurga/agent-deck/releases/tag/v0.2.0
