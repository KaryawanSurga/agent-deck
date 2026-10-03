# Architecture — Agent Deck

**Version:** 0.1.0

## Overview

Agent Deck is a single local process with three user surfaces — CLI, dashboard, and HTTP API — over one core: a process manager that spawns configured agents, captures their output, and broadcasts state changes.

```text
             ┌──────────────────────────────┐
  CLI ──────►│                              │
  Browser ──►│         Agent Deck           │
  HTTP  ────►│  server.ts (http + SSE)      │
             │      │                       │
             │      ▼                       │
             │  manager.ts ── spawn ──► child processes
             │      │  │                    │
             │      │  └── events.ts ──► SSE subscribers
             │      ▼                       │
             │  store.ts (.agent-deck/)     │
             └──────────────────────────────┘
```

## Components

### `src/core/config.ts`

Parses `agent-deck.json`: an agents map (command, args, cwd, env, description) plus an `idleAfterMs` window. Names are validated, agents are sorted, and the default demo agent ships with `init`.

### `src/core/store.ts`

Owns `.agent-deck/`: `sessions.json` (index, capped at 100 sessions, written atomically via temp file + rename) and `logs/<session-id>.log`. Log tails read at most the last 512 KB and drop a partial first line, so a huge log never floods memory.

### `src/core/manager.ts`

The heart of the tool:

- `start(agent)` spawns the process with piped stdio and creates a session record.
- Output chunks are appended to the session log, counted, timestamped, and broadcast as events.
- Exit handling maps processes to terminal states: code 0 → `exited`, non-zero → `failed`, killed by user → `stopped`.
- `close()` marks children as user-stopped and kills them; the session index is written on every terminal transition.
- On construction, sessions left `running` by a previous process are recovered as `stopped`, so the index never lies.

Persist throttling keeps streaming cheap: ordinary output writes at most every 500 ms, terminal states force a write.

### `src/core/events.ts`

A tiny subscriber set with safe dispatch. The server subscribes to feed SSE; the CLI subscribes to stream `run` output.

### `src/core/status.ts`

Pure function computing the live status: terminal states are returned as-is; a running session becomes `idle` when its last output is older than `idleAfterMs`.

### `src/server.ts`

`node:http` only. Serves the dashboard page, JSON API endpoints, and the SSE stream. JSON bodies are capped at 64 KB; unknown routes return JSON 404s; SSE sends an initial snapshot, then `session` and `output` events, with a keep-alive comment every 15 seconds.

### `src/dashboard.ts`

A self-contained HTML page (no framework, no build step). It subscribes to `/api/events`, renders agents and sessions, appends output chunks, and posts start/stop actions. All process output is written through `textContent`, so logs cannot inject markup.

## Data flow: one run

1. `POST /api/sessions {"agent":"demo"}` (or `agent-deck run demo`).
2. `manager.start` spawns the process and records the session.
3. stdout/stderr chunks → session log file → `output` events → SSE → dashboard output pane.
4. Exit → status computed from code and `stoppedByUser` → `session` event → dashboard status dot updates.
5. The session index is persisted; `GET /api/sessions/:id/log` serves history after a restart.

## Failure model

| Failure | Behavior |
| --- | --- |
| Command not found | Spawn error → session marked `failed`, message appended to its log. |
| Non-zero exit | Session marked `failed` with the exit code recorded. |
| Process killed | Session marked `stopped` (dashboard or CLI). |
| Server restarted mid-run | Previous `running` sessions are recovered as `stopped` on startup. |
| Corrupted session index | Treated as empty; new sessions keep working. |
| SSE client disconnects | Subscriber removed; keep-alive timer cleared. |

## Security notes

- Binds `127.0.0.1` by default and has no authentication; do not expose it to a network without a proxy that adds auth.
- Agents run with the same privileges as the Agent Deck process.
- The dashboard never uses `innerHTML`; process output cannot execute script in the page.

## Extension points

- **PTY sessions** (v0.2): swap `spawn` stdio pipes for a PTY and stream raw terminal data.
- **Notifications**: subscribe to `session` events and forward terminal states.
- **Worktrees**: create a git worktree before spawn and set it as `cwd`.
- **Task queue**: a scheduler on top of `manager.start` with dependency gates.
- **Remote agents**: replace the local spawn with an SSH transport behind the same manager API.
