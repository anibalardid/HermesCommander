#!/usr/bin/env bash
# Hermes Commander daemon launcher.
# Usage:
#   ./hermes-commander.sh start   # start the daemon (background)
#   ./hermes-commander.sh stop    # stop the daemon
#   ./hermes-commander.sh status  # show status
#   ./hermes-commander.sh logs    # tail the daemon log
#
# Works on macOS and Linux. On macOS you can also use the launchd plist
# (see deploy/com.anibal.hermes-commander.plist) for auto-start at login.

set -euo pipefail

# Resolve the repo root (parent of this script's dir).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT/apps/server"
PID_FILE="$ROOT/.hermes-commander.pid"
LOG_FILE="$ROOT/.hermes-commander.log"
DB_PATH="${HERMES_COMMANDER_DB:-$ROOT/data/hermes-commander.db}"
PORT="${PORT:-4310}"
HOST="${HOST:-0.0.0.0}"

# Prefer the compiled build; fall back to tsx dev if dist is missing.
if [ -f "$SERVER_DIR/dist/index.js" ]; then
  RUN_CMD=(node "$SERVER_DIR/dist/index.js")
else
  RUN_CMD=(npx tsx "$SERVER_DIR/src/index.ts")
fi

start() {
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Hermes Commander already running (pid $(cat "$PID_FILE"))."
    exit 0
  fi
  mkdir -p "$(dirname "$DB_PATH")"
  echo "Starting Hermes Commander on $HOST:$PORT (db: $DB_PATH)..."
  HERMES_COMMANDER_DB="$DB_PATH" PORT="$PORT" HOST="$HOST" nohup "${RUN_CMD[@]}" >>"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  sleep 1
  echo "Started (pid $(cat "$PID_FILE")). Log: $LOG_FILE"
}

stop() {
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    kill "$(cat "$PID_FILE")"
    rm -f "$PID_FILE"
    echo "Stopped."
  else
    echo "Not running."
  fi
}

status() {
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Running (pid $(cat "$PID_FILE"))."
  else
    echo "Not running."
  fi
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  logs) tail -f "$LOG_FILE" ;;
  *) echo "Usage: $0 {start|stop|status|logs}"; exit 1 ;;
esac
