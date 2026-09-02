#!/usr/bin/env bash
# start.sh — Hermes Commander startup with Hermes validation and services.
#
# Orchestrates the project's services startup in order:
#   1. database (SQLite, embedded in the API — not a separate process)
#   2. api        (Fastify, port 4310)
#   3. frontend   (Vite, port 5173)
#
# Before starting:
#   - Validates that Hermes (the orchestrator) is running.
#   - Detects THIS repo's services already running and, if any, asks ONE
#     confirmation to stop and restart them.
#
# Repo-scoped detection:
#   - A service is considered "from this repo" if its PID is registered in a
#     PID file under data/ (written by start.sh) and still alive, OR if the
#     process listening on the port has its cwd under the repo root. A process
#     that cannot be proven to belong to this repo is never stopped
#     (e.g. another hermes-commander checkout, or opencode listening on 5173).
#
# Idempotency:
#   - Starting a service that is already running (from this repo) does not
#     error or duplicate: it is skipped and reported.
#
# Usage:
#   ./start.sh
#
# Requires lib/common.sh (source). Compatible with bash 3.2+ (macOS) and bash 4+.

set -uo pipefail

# Resolve the repo root (the directory containing this script).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$ROOT/lib/common.sh"

# ---------------------------------------------------------------------------
# Configuration (discovered from the repo; overridable via environment)
# ---------------------------------------------------------------------------
DATA_DIR="$ROOT/data"
# The API runs with cwd apps/server and resolves 'data/hermes-commander.db' relative to
# it, so the real database lives at apps/server/data/hermes-commander.db (NOT $ROOT/data).
DB_PATH="${HERMES_COMMANDER_DB:-$ROOT/apps/server/data/hermes-commander.db}"
API_PORT="${PORT:-4310}"      # apps/server/src/index.ts  (PORT)
WEB_PORT="${WEB_PORT:-5173}"  # apps/web/vite.config.ts   (server.port)

API_PID_FILE="$DATA_DIR/api.pid"
WEB_PID_FILE="$DATA_DIR/web.pid"
API_LOG="$DATA_DIR/api.log"
WEB_LOG="$DATA_DIR/web.log"

GRACE_SECS="${GRACE_SECS:-5}"

# ---------------------------------------------------------------------------
# Repo-scoped detection
# ---------------------------------------------------------------------------

# api_pids — PIDs of THIS repo's backend: those registered in the PID file that
# are still alive, plus those listening on API_PORT with cwd under ROOT.
api_pids() {
  local pids=""
  pids="$pids $(pid_file_pid "$API_PID_FILE")"
  pids="$pids $(pids_on_port_for_repo "$API_PORT" "$ROOT")"
  dedupe_pids "$pids"
}

# repo_web_port <repo_root> — the TCP port this repo's Vite frontend is
# currently listening on (any port), or nothing if it isn't running. This lets
# start.sh recognize a HermesCommander frontend regardless of which port it
# ended up on, instead of only checking the hardcoded WEB_PORT.
repo_web_port() {
  local root="${1:-}" pid port
  [ -n "$root" ] || return 1
  for pid in $(pgrep -f 'vite' 2>/dev/null); do
    pid_belongs_to_repo "$pid" "$root" || continue
    # Extract the numeric listen port from the NAME field, which looks like
    # `*:5175`. Match the `:digits` suffix (NOT the PID column, which is also
    # all-digits) so we don't misread the process id as the port.
    port="$(lsof -a -p "$pid" -iTCP -sTCP:LISTEN -P 2>/dev/null | awk '
      /LISTEN/ {
        for (i=1; i<=NF; i++) {
          if (match($i, /:[0-9]+$/)) { sub(/^.*:/, "", $i); print $i; exit }
        }
      }')"
    [ -n "$port" ] && { printf '%s\n' "$port"; return 0; }
  done
  return 1
}

# hermes_running — true if the Hermes gateway is running.
# The gateway listens on :8642 and its process contains "gateway run".
hermes_running() {
  is_running "gateway run" || [ -n "$(pids_on_port 8642)" ]
}

# ---------------------------------------------------------------------------
# Startup of each service
# ---------------------------------------------------------------------------

start_db() {
  print_status "Database (SQLite, embedded in the API)"
  mkdir -p "$DATA_DIR"
  print_ok "Data directory ready: $DATA_DIR"
  print_status "SQLite is not a separate process: the API creates/migrates it on startup (Store)."
}

start_api() {
  print_status "Starting API (Fastify) on port $API_PORT..."
  ( cd "$ROOT" && nohup npm run dev:server >"$API_LOG" 2>&1 & echo $! >"$API_PID_FILE" )
  # Verification: OUR repo's process must actually be listening on $API_PORT.
  # A plain "port open" check would wrongly report success if another app
  # already holds the port while our API failed to bind.
  if wait_for_repo_pid_on_port "$API_PORT" "$ROOT" 30; then
    print_ok "API started correctly (port $API_PORT open)."
    return 0
  elif [ -f "$API_PID_FILE" ] && pid_alive "$(cat "$API_PID_FILE")"; then
    print_ok "API started (process alive, pid $(cat "$API_PID_FILE"))."
    return 0
  else
    print_error "The API did not start. Check $API_LOG"
    print_warn "Port $API_PORT may be held by another application."
    return 1
  fi
}

start_web() {
  local target="$WEB_PORT"
  # Resolve a free port AT START TIME. The configured port (default 5173) may
  # be held by another app (e.g. OpenCode) — even when we just stopped OUR
  # frontend, the foreign app is still there. Auto-pick the next free port so
  # a clean start and a restart both work.
  if port_held_by_other "$target" "$ROOT"; then
    local free
    free="$(pick_free_port "$target")"
    if [ -n "$free" ]; then
      print_warn "Port $target is in use by another application."
      print_warn "  Auto-selecting free port $free for the frontend."
      target="$free"
    else
      print_error "No free port available near $target."
      return 1
    fi
  fi
  print_status "Starting frontend (Vite) on port $target..."
  # Force Vite onto EXACTLY $target (--strictPort) so it never silently
  # auto-increments to a different port when the configured one is taken —
  # otherwise the printed URL would be wrong. --port also overrides the
  # hardcoded 5173 in vite.config.ts. Invoke vite directly to avoid nested-npm
  # argument forwarding (which swallows --port/--strictPort through workspaces).
  ( cd "$ROOT/apps/web" && nohup "$ROOT/node_modules/.bin/vite" --port "$target" --strictPort --host 0.0.0.0 >"$WEB_LOG" 2>&1 & echo $! >"$WEB_PID_FILE" )
  # Verification: a live process from THIS repo must actually be listening on
  # $target. We cannot just check "port open" — another app (e.g. Laravel on
  # 5173) may already hold the port, and with --strictPort Vite fails to bind
  # and exits. Only report success when the port is held by OUR process.
  if wait_for_repo_pid_on_port "$target" "$ROOT" 30; then
    print_ok "Frontend started correctly (port $target open)."
    WEB_PORT="$target"
    return 0
  elif [ -f "$WEB_PID_FILE" ] && pid_alive "$(cat "$WEB_PID_FILE")"; then
    print_ok "Frontend started (process alive, pid $(cat "$WEB_PID_FILE"))."
    WEB_PORT="$target"
    return 0
  else
    print_error "The frontend did not start. Check $WEB_LOG"
    print_warn "Port $target may be held by another application (see $WEB_LOG)."
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Port / wait helpers
# ---------------------------------------------------------------------------

# port_in_use <port> — true (0) if something is listening on the port.
port_in_use() {
  local port="${1:-}"
  [ -n "$port" ] || return 1
  [ -n "$(pids_on_port "$port")" ]
}

# pick_free_port <start> — print the first port >= <start> that is free. Useful
# when the configured port is held by another app: fall back to the next free
# one instead of aborting.
pick_free_port() {
  local start="${1:-5173}" p
  for p in $(seq "$start" "$((start + 200))"); do
    if ! port_in_use "$p"; then
      printf '%s\n' "$p"
      return 0
    fi
  done
  return 1
}

# port_held_by_other <port> <repo_root> — true (0) if the port is listening but
# NONE of its holders belong to this repo (i.e. another application owns it).
# We treat a port as "safe to start on" only when it is free OR already held by
# our own repo (idempotent restart). Anything else blocks startup: starting
# there would silently collide (or, with --strictPort, fail to bind).
port_held_by_other() {
  local port="${1:-}" root="${2:-}" pid any_ours=0
  [ -n "$port" ] || return 1
  for pid in $(pids_on_port "$port"); do
    if pid_belongs_to_repo "$pid" "$root"; then
      any_ours=1
    else
      return 0   # a foreign holder found → blocked
    fi
  done
  return 1
}

# wait_for_repo_pid_on_port <port> <repo_root> <seconds> — waits until a process
# from this repo is listening on the port. Unlike wait_for_port (which any app
# satisfies), this confirms OUR frontend/API actually bound the port.
wait_for_repo_pid_on_port() {
  local port="${1:-}" root="${2:-}" timeout="${3:-25}" i
  [ -n "$port" ] && [ -n "$root" ] || return 1
  for i in $(seq 1 "$timeout"); do
    if ! port_held_by_other "$port" "$root"; then
      # Not blocked by a foreign app; see if OUR process is up.
      [ -n "$(pids_on_port_for_repo "$port" "$root")" ] && return 0
    fi
    sleep 1
  done
  return 1
}

# wait_for_port <port> <seconds> — waits for the port to open. 0 if it opened.
wait_for_port() {
  local port="${1:-}" timeout="${2:-25}" i
  for i in $(seq 1 "$timeout"); do
    if port_in_use "$port"; then return 0; fi
    sleep 1
  done
  return 1
}

# ---------------------------------------------------------------------------
# Main flow
# ---------------------------------------------------------------------------

echo
print_status "Hermes Commander — service startup"
echo

# 1. Validate Hermes ---------------------------------------------------------
print_status "Validating Hermes (orchestrator)..."
if hermes_running; then
  print_ok "Hermes is already running (gateway active)."
else
  print_warn "Hermes is not running. Hermes Commander uses Hermes as orchestrator:"
  print_warn "  without the gateway, missions cannot spawn agents."
  print_warn "  Start it with: hermes gateway start"
fi
echo

# 1b. Project dependencies (npm ci) -----------------------------------------
# node_modules is gitignored, so a fresh clone has no dependencies installed.
# Without them the API/frontend cannot start (e.g. `tsx: command not found`).
# If node_modules is missing, ask before proceeding.
if ! node_modules_present "$ROOT"; then
  echo
  print_warn "node_modules not found — project dependencies are not installed."
  print_warn "  The API and frontend cannot start without them."
  if ask_confirm "Run 'npm ci' to install project dependencies?"; then
    print_status "Installing project dependencies (npm ci)..."
    if npm_ci "$ROOT"; then
      print_ok "Project dependencies installed."
    else
      print_error "npm ci failed (exit $?). Aborting startup."
      exit 1
    fi
  else
    print_error "Dependencies not installed. Run './install.sh' or 'npm ci' first."
    exit 1
  fi
  echo
fi

# 2. Detect THIS repo's services already running ---------------------------
# The API is detected on its configured port; the frontend is detected on ANY
# port it may be listening on now (repo_web_port), because a previous run may
# have left it on a different port than the current WEB_PORT.
API_PIDS="$(api_pids)"
DETECTED_WEB_PORT="$(repo_web_port "$ROOT")"
if [ -n "$DETECTED_WEB_PORT" ]; then
  WEB_PIDS="$(pids_on_port_for_repo "$DETECTED_WEB_PORT" "$ROOT")"
else
  WEB_PIDS=""
fi

# 2b. Pre-flight port auto-pick (API only) ----------------------------------
# The frontend's port is resolved inside start_web() at the moment it starts,
# because it must handle both a clean start AND a restart (where our frontend
# was just stopped but a foreign app may still hold the configured port).
# Here we only pre-resolve the API port, which must match what dev:server uses.
if [ -z "$API_PIDS" ] && port_held_by_other "$API_PORT" "$ROOT"; then
  free="$(pick_free_port "$API_PORT")"
  if [ -n "$free" ]; then
    print_warn "Port $API_PORT is in use by another application."
    print_warn "  Auto-selecting free port $free for the API."
    API_PORT="$free"
  else
    print_error "No free port available near $API_PORT."
    exit 1
  fi
fi

# 3. Single confirmation before any destructive action ---------------------
# Only asked if there is something to stop. A single prompt covers API and
# frontend; there is no double confirmation.
if [ -n "$API_PIDS" ] || [ -n "$WEB_PIDS" ]; then
  echo
  print_status "Services from this repo already running:"
  [ -n "$API_PIDS" ] && print_status "  API:      pid(s) $(echo "$API_PIDS" | tr '\n' ' ')"
  [ -n "$WEB_PIDS" ] && print_status "  Frontend: pid(s) $(echo "$WEB_PIDS" | tr '\n' ' ')"
  if ask_confirm "Stop and restart them?"; then
    RESTART=1
  else
    print_warn "Keeping them running; their restart is skipped."
    RESTART=0
  fi
else
  RESTART=0
fi

# 4. Stop (if confirmed) ----------------------------------------------------
if [ "$RESTART" -eq 1 ]; then
  echo
  if [ -n "$API_PIDS" ]; then
    print_status "Stopping API..."
    for pid in $API_PIDS; do
      stop_pid "$pid" "$GRACE_SECS" || print_warn "Could not stop pid $pid"
    done
    rm -f "$API_PID_FILE"
    print_ok "API stopped."
  fi
  if [ -n "$WEB_PIDS" ]; then
    print_status "Stopping frontend..."
    for pid in $WEB_PIDS; do
      stop_pid "$pid" "$GRACE_SECS" || print_warn "Could not stop pid $pid"
    done
    rm -f "$WEB_PID_FILE"
    print_ok "Frontend stopped."
  fi
fi

# Database (SQLite): not a process; we only report whether the file exists.
if [ -f "$DB_PATH" ]; then
  print_status "The database already exists ($DB_PATH)."
  print_status "  Being embedded SQLite, it needs no separate stop: it reopens with the API."
else
  print_status "No previous database; it will be created when the API starts."
fi
echo

# 5. Start in order: db → api → frontend -----------------------------------
FAIL=0

start_db
echo

if [ -n "$(api_pids)" ]; then
  print_warn "API skipped (already running from this repo)."
else
  start_api || FAIL=1
fi
echo

if [ -n "$(repo_web_port "$ROOT")" ]; then
  print_warn "Frontend skipped (already running from this repo)."
else
  start_web || FAIL=1
fi
echo

# 6. Final verification -----------------------------------------------------
# If the frontend/API were already running, report the port they are ACTUALLY
# on (which may differ from the configured WEB_PORT/API_PORT).
DETECTED_WEB_PORT="$(repo_web_port "$ROOT")"
FINAL_WEB_PORT="${DETECTED_WEB_PORT:-$WEB_PORT}"
print_status "Final verification:"
if [ -f "$DB_PATH" ]; then
  print_ok "Database: present ($DB_PATH)."
else
  print_warn "Database: not yet present (created on the API's first start)."
fi
if [ -n "$(api_pids)" ]; then
  print_ok "API: running (this repo's process detected)."
else
  print_error "API: NOT running."
  FAIL=1
fi
if [ -n "$FINAL_WEB_PORT" ] && [ -n "$(repo_web_port "$ROOT")" ]; then
  print_ok "Frontend: running (this repo's process detected)."
else
  print_error "Frontend: NOT running."
  FAIL=1
fi
echo

if [ "$FAIL" -eq 0 ]; then
  print_ok "All services started correctly."
  echo
  echo "─────────────────────────────────────────────────────"
  echo "  Frontend:  http://127.0.0.1:${FINAL_WEB_PORT}/"
  echo "  API:       http://127.0.0.1:${API_PORT}"
  echo "  DB:        ${DB_PATH}"
  echo "─────────────────────────────────────────────────────"
  echo
  print_ok "Open the frontend at:  ${C_BOLD}http://127.0.0.1:${FINAL_WEB_PORT}/${C_RESET}"
  echo
  exit 0
else
  print_error "One or more services did not start. Check the logs in $DATA_DIR/."
  exit 1
fi
