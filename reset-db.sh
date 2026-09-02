#!/usr/bin/env bash
# reset-db.sh — wipe the Hermes Commander database and re-initialize it from scratch.
#
# The database is SQLite embedded in the API: the Store creates/migrates/seeds
# it automatically on startup. So "resetting" means:
#   1. Stop the API (so the DB file is not locked).
#   2. Delete the DB file (+ WAL/SHM sidecars).
#   3. Start the API again — it recreates the schema, runs migrations and
#      seeds the default agents/recipes on first start.
#
# Safety — TWO confirmations:
#   1. A standard yes/no prompt.
#   2. If confirmed, the user must type today's date (YYYY-MM-DD) to proceed.
#      This is a destructive, irreversible action.
#
# Usage:
#   ./reset-db.sh          # interactive (two confirmations)
#   ./reset-db.sh --help   # help
#
# Requires lib/common.sh (source). Compatible with bash 3.2+ (macOS) and bash 4+.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$ROOT/lib/common.sh"

# ---------------------------------------------------------------------------
# Configuration (overridable via environment)
# ---------------------------------------------------------------------------
DATA_DIR="$ROOT/data"
# The API runs with cwd apps/server and resolves 'data/hermes-commander.db' relative to
# it, so the real database lives at apps/server/data/hermes-commander.db (NOT $ROOT/data).
DB_PATH="${HERMES_COMMANDER_DB:-$ROOT/apps/server/data/hermes-commander.db}"
API_PORT="${PORT:-4310}"      # apps/server/src/index.ts  (PORT)
API_PID_FILE="$DATA_DIR/api.pid"
API_LOG="$DATA_DIR/api.log"
GRACE_SECS="${GRACE_SECS:-5}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# api_pids — PIDs of THIS repo's backend (PID file + port with cwd under ROOT).
api_pids() {
  local pids=""
  pids="$pids $(pid_file_pid "$API_PID_FILE")"
  pids="$pids $(pids_on_port_for_repo "$API_PORT" "$ROOT")"
  dedupe_pids "$pids"
}

# port_in_use <port> — true (0) if something is listening on the port.
port_in_use() {
  local port="${1:-}"
  [ -n "$port" ] || return 1
  [ -n "$(pids_on_port "$port")" ]
}

# wait_for_port <port> <seconds> — waits for the port to open. 0 if it opened.
wait_for_port() {
  local port="${1:-}" timeout="${2:-30}" i
  for i in $(seq 1 "$timeout"); do
    if port_in_use "$port"; then return 0; fi
    sleep 1
  done
  return 1
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

case "${1:-}" in
  -h|--help)
    sed -n '2,20p' "$0"
    exit 0
    ;;
esac

echo
print_status "Hermes Commander — database reset"
echo
print_warn "This will DELETE the entire database and re-initialize it from scratch."
print_warn "  Database: $DB_PATH"
print_warn "  All projects, missions, tasks, runs and logs will be lost."
echo

# --- Confirmation 1: standard yes/no ---
if ! ask_confirm "Reset the database? (this is destructive)"; then
  print_warn "Cancelled — nothing was done."
  exit 0
fi

# --- Confirmation 2: type today's date ---
TODAY="$(date +%Y-%m-%d)"
echo
print_status "Type today's date ($TODAY) to confirm the reset:"
printf '> '
IFS= read -r typed
if [ "$typed" != "$TODAY" ]; then
  print_error "Confirmation failed — expected '$TODAY', got '${typed:-<empty>}'. Aborting."
  exit 1
fi

echo
print_status "Confirmed. Stopping the API..."

# --- Stop the API (so the DB file is not locked) ---
API_PIDS="$(api_pids)"
if [ -n "$API_PIDS" ]; then
  for pid in $API_PIDS; do
    stop_pid "$pid" "$GRACE_SECS" || print_warn "Could not stop pid $pid"
  done
  rm -f "$API_PID_FILE"
  print_ok "API stopped."
else
  print_ok "API was not running."
fi

# --- Delete the DB files ---
print_status "Deleting database files..."
rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm"
if [ -f "$DB_PATH" ]; then
  print_error "Could not delete $DB_PATH (still present)."
  exit 1
fi
print_ok "Database removed."

# --- Re-initialize: start the API (Store recreates schema + seeds) ---
print_status "Starting API to re-initialize the database..."
mkdir -p "$DATA_DIR"
( cd "$ROOT" && nohup npm run dev:server >"$API_LOG" 2>&1 & echo $! >"$API_PID_FILE" )
if wait_for_port "$API_PORT" 30; then
  print_ok "API started (port $API_PORT open)."
else
  print_error "API did not start. Check $API_LOG"
  exit 1
fi

# --- Verify the DB was recreated ---
if [ -f "$DB_PATH" ]; then
  print_ok "Database re-initialized: $DB_PATH"
else
  print_warn "Database file not found yet — it may be created on the first request."
fi

echo
print_ok "Database reset complete."
exit 0
