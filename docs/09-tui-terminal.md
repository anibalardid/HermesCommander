# 09 — Embedded Terminal (Hermes TUI)

Hermes Commander embeds a real Hermes TUI terminal directly in the workspace panel
(the `Terminal` tab), so you can drive an interactive Hermes session from your
phone/browser without a separate SSH client. It is a faithful copy of the
approach used by `hermes-workspace`.

## How it works

```
xterm.js (browser)  --WebSocket /ws/terminal-->  Hermes Commander server
                                                      |
                                                      v
                                    python pty-helper (spawns PTY)
                                                      |
                                                      v
                                   hermes --tui -p <profile> --in <cwd>
```

- The **frontend** renders an [`@xterm/xterm`](https://xtermjs.org) pane.
- The **server** (apps/server/src/terminal) opens a real pseudo-terminal via a
  stdlib-only Python helper (`pty-helper.py`) and bridges it over WebSocket.
  No native `node-pty` build is required.
- Launching runs `hermes --tui -p <profile> --in <cwd>` in that PTY.
- **Kill-on-leave**: closing the tab / WebSocket terminates the session
  (SIGTERM, then SIGKILL after 2s) so no orphan Hermes process lingers.

## Prerequisites (host where the server runs)

| Requirement | Why | Check |
|-------------|-----|-------|
| **python3** (any 3.7+, stdlib only) | runs the PTY helper | `python3 --version` |
| **hermes** CLI on PATH | the actual TUI binary | `hermes --version` |
| **PTY helper file** (`apps/server/src/terminal/pty-helper.py`) | shipped with the repo | file exists |

All are checked automatically: the frontend calls `GET /api/terminal/status`
and shows an install-help message if anything is missing.

## Setup / install

Run the installer from the repo root:

```bash
./deploy/setup-terminal.sh         # check + report
./deploy/setup-terminal.sh --fix   # attempt to install missing pieces
```

macOS: `python3` ships with the OS. The `hermes` CLI is installed separately
(see https://hermes-agent.nousresearch.com/docs) and must be on the PATH of the
service running the Hermes Commander server.

## API

- `GET /api/terminal/status` →
  ```json
  { "status": { "available": bool, "python": bool, "helper": bool, "hermes": bool } }
  ```
- `GET /api/terminal/profiles` → `{ "profiles": [{ name, model, provider }] }`
- `WS /ws/terminal` — one PTY per socket. First client frame:
  ```json
  { "type": "open", "profile": "default", "cwd": "/path/to/repo", "cols": 80, "rows": 24 }
  ```
  Then the client sends `{ "type": "input", "data": "<base64>" }` and
  `{ "type": "resize", "cols": N, "rows": N }`; the server streams
  `{ "type": "data", "data": "<base64>" }` and exits `{ "type": "exit" }`.

## Files

- `apps/server/src/terminal/pty-helper.py` — Python PTY helper (stdlib only)
- `apps/server/src/terminal/sessions.ts` — WebSocket↔PTY bridge, kill-on-leave
- `apps/server/src/terminal/routes.ts` — status/profiles/WS routes
- `apps/web/src/components/workspace/TerminalTab.tsx` — xterm.js React component
- `deploy/setup-terminal.sh` — prerequisite checker/installer
