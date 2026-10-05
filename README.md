# Agent Deck

[![CI](https://github.com/KaryawanSurga/agent-deck/actions/workflows/ci.yml/badge.svg)](https://github.com/KaryawanSurga/agent-deck/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

**Local mission control for long-running agent jobs.**

Agents run for minutes or hours. Agent Deck gives you a live dashboard for them: start configured agents, watch their output stream in real time, see status at a glance (running, idle, exited, failed, stopped), and stop them when needed. Optional PTY sessions let interactive tools print like they would in a terminal, and webhook notifications tell you when a run fails — even when nobody is watching the dashboard.

Zero required dependencies — Node's HTTP, child process, and file system modules only. PTY sessions use an optional native package and fail with a clear message when it is unavailable.

Second flagship in the KaryawanSurga toolbox: the [TokenSaver family](https://github.com/KaryawanSurga/tokensaver-plugin) keeps agents cheap, and Agent Deck keeps them visible.

> Product requirements: [PRD.md](PRD.md) · [PRD.id.md](PRD.id.md) (Bahasa Indonesia)

## Why

- Long agent runs are invisible. You either stare at a terminal or discover hours later that the process died at minute two.
- Multiple jobs in parallel mean multiple terminals, no shared status, no history.
- Existing dashboards assume a hosted platform; this one is a single local process with a browser UI.
- You want to stop a runaway agent without hunting for its PID.

## Quick start

```sh
npx -y agent-deck init          # writes agent-deck.json with a demo agent
npx -y agent-deck run demo      # stream an agent's output here
npx -y agent-deck run demo --pty # optional: run it through a pseudo-terminal
npx -y agent-deck serve         # live dashboard at http://127.0.0.1:8787
```

Dashboard features: agent list with start buttons, session list with status dots, live output pane over Server-Sent Events, stop buttons, and per-session log tails after a restart.

## Configuration

`agent-deck.json`:

```json
{
  "idleAfterMs": 5000,
  "notifyUrl": "http://127.0.0.1:9000/hooks/agent-deck",
  "agents": {
    "docs": {
      "command": "npx",
      "args": ["-y", "commitsmith"],
      "cwd": "./worktrees/docs",
      "description": "Commit helper for the docs worktree"
    },
    "tests": {
      "command": "npm",
      "args": ["test"],
      "description": "Full test suite"
    },
    "repl": {
      "command": "npx",
      "args": ["-y", "some-interactive-agent"],
      "pty": true,
      "description": "Interactive agent that expects a terminal"
    }
  }
}
```

Agents are ordinary commands. Anything that prints to stdout/stderr and eventually exits works — coding agents in print mode, test suites, data jobs, watchers. Set `"pty": true` (or pass `--pty` to `run`) for tools that expect a pseudo-terminal, and set `notifyUrl` to receive a POST with the session summary whenever a run reaches a terminal state.

## CLI

| Command | What it does |
| --- | --- |
| `agent-deck init [--force]` | Write a starter config. |
| `agent-deck list [--json]` | Show agents and recent sessions with live status. |
| `agent-deck run <agent> [--pty]` | Start an agent and stream its output here; exits with the agent's outcome. |
| `agent-deck logs <session-id> [--tail <n>]` | Print a session's log tail. |
| `agent-deck export <session-id> [--out <file>]` | Print a session record and its log as JSON. |
| `agent-deck prune [--days <n>]` | Delete finished sessions and logs older than N days (default 7). |
| `agent-deck serve [--port <n>] [--host <h>]` | Live dashboard and API. |

Global options: `--config <path>` (default `./agent-deck.json`), `--state <dir>` (default `./.agent-deck`).

Exit codes: `0` ok, `1` agent failed or a file problem, `2` usage error. `run` exits `0` only when the agent exited cleanly.

## Dashboard API

| Endpoint | Purpose |
| --- | --- |
| `GET /` | The dashboard page. |
| `GET /health` | Liveness and session count. |
| `GET /api/agents` | Configured agents. |
| `GET /api/sessions` | Sessions with live status. |
| `POST /api/sessions` | Start a session: `{"agent": "name"}`. |
| `POST /api/sessions/:id/stop` | Stop a running session. |
| `GET /api/sessions/:id/log?tail=n` | Log tail for one session. |
| `GET /api/events` | Server-Sent Events: snapshots, session updates, output chunks. |

## How status works

- **running** — the process is alive and wrote output within `idleAfterMs`.
- **idle** — alive, but silent longer than the window (waiting on a model, a lock, or a prompt).
- **exited** — finished with code 0.
- **failed** — finished with a non-zero code or failed to spawn.
- **stopped** — killed from the dashboard or CLI, including sessions recovered after a restart.

State lives in `.agent-deck/` (sessions index plus one log file per session). Sessions left running by a previous process are marked stopped on the next start, so the list never lies.

## Design principles

- **Zero required dependencies**: no framework, no WebSocket library — SSE over Node's HTTP server. PTY is optional and isolated behind one module.
- **Local-only**: binds `127.0.0.1` by default; no telemetry, no accounts.
- **Bounded**: log tails are capped, session history is capped at 100 runs, and `prune` keeps the state directory tidy.
- **Honest**: spawn errors, non-zero exits, recovered sessions, and failed webhook deliveries are all reported.
- **Boring on purpose**: JSON config, plain files, readable code.

## Limitations (v0.2.0)

- PTY sessions need the optional `@homebridge/node-pty-prebuilt-multiarch` package. Without it, `pty: true` agents fail with a clear message and pipe agents keep working. PTY output includes terminal control sequences; the dashboard shows the raw stream.
- Single machine, single process. `stop` works for sessions owned by the running dashboard; a standalone `run` owns its session.
- No authentication. Keep the default loopback bind or provide your own proxy.

## Roadmap

- Worktree-aware agents: create a git worktree per session.
- Task queue with dependencies and quality gates.
- Desktop notifications and retrying webhook delivery.
- Multi-machine agents over SSH.

## Development

```sh
npm install
npm run typecheck
npm run build
npm test
```

The suite covers config parsing, the session store, spawn/exit/stop flows against real fixture processes, both transports, idle detection, notifications, pruning, export, the dashboard API, Server-Sent Events, and the CLI.

Note for npm >= 12: the optional PTY package runs install scripts. This repository ships an `allowScripts` entry for it in `package.json`; if your npm still blocks the script, approve it once with `npm install-scripts approve @homebridge/node-pty-prebuilt-multiarch`.

## License

MIT — see [LICENSE](LICENSE).
