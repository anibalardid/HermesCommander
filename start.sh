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

# web_pids — PIDs of THIS repo's frontend (PID file + port with cwd under ROOT).
web_pids() {
  local pids=""
  pids="$pids $(pid_file_pid "$WEB_PID_FILE")"
  pids="$pids $(pids_on_port_for_repo "$WEB_PORT" "$ROOT")"
  dedupe_pids "$pids"
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
  # Verification: live process (PID file) + open port as a secondary signal.
  if wait_for_port "$API_PORT" 30; then
    print_ok "API started correctly (port $API_PORT open)."
    return 0
  elif [ -f "$API_PID_FILE" ] && pid_alive "$(cat "$API_PID_FILE")"; then
    print_ok "API started (process alive, pid $(cat "$API_PID_FILE"))."
    return 0
  else
    print_error "The API did not start. Check $API_LOG"
    return 1
  fi
}

start_web() {
  print_status "Starting frontend (Vite) on port $WEB_PORT..."
  ( cd "$ROOT" && nohup npm run dev:web >"$WEB_LOG" 2>&1 & echo $! >"$WEB_PID_FILE" )
  # Verification: live process (PID file) + open port as a secondary signal.
  if wait_for_port "$WEB_PORT" 30; then
    print_ok "Frontend started correctly (port $WEB_PORT open)."
    return 0
  elif [ -f "$WEB_PID_FILE" ] && pid_alive "$(cat "$WEB_PID_FILE")"; then
    print_ok "Frontend started (process alive, pid $(cat "$WEB_PID_FILE"))."
    return 0
  else
    print_error "The frontend did not start. Check $WEB_LOG"
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
API_PIDS="$(api_pids)"
WEB_PIDS="$(web_pids)"

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

if [ -n "$(web_pids)" ]; then
  print_warn "Frontend skipped (already running from this repo)."
else
  start_web || FAIL=1
fi
echo

# 6. Final verification -----------------------------------------------------
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
if [ -n "$(web_pids)" ]; then
  print_ok "Frontend: running (this repo's process detected)."
else
  print_error "Frontend: NOT running."
  FAIL=1
fi
echo

if [ "$FAIL" -eq 0 ]; then
  print_ok "All services started correctly."
  exit 0
else
  print_error "One or more services did not start. Check the logs in $DATA_DIR/."
  exit 1
fi
