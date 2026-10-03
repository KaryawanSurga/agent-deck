# Changelog

All notable changes to Agent Deck are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
