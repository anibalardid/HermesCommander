#!/usr/bin/env bash
# stop.sh — stops Hermes Commander services (api, database, frontend).
#
# Usage:
#   ./stop.sh          # detects and asks for confirmation (single, if any)
#   ./stop.sh -y       # stops everything without asking (non-interactive)
#   ./stop.sh --help   # help
#
# Behavior:
#   1. Sources lib/common.sh.
#   2. Detects THIS repo's running services (api, frontend).
#   3. If there is anything to stop, asks ONE confirmation (or none with -y).
#   4. Stops with the correct mechanism (PID kill, SIGTERM → SIGKILL).
#   5. If nothing is running, prints "No services running" and exits.
#   6. Reports what was stopped and what failed.
#
# Repo-scoped detection:
#   - A service is considered "from this repo" if its PID is registered in a
#     PID file under data/ (written by start.sh) and still alive, OR if the
#     process listening on the port has its cwd under the repo root. A process
#     that cannot be proven to belong to this repo is never stopped
#     (e.g. another hermes-commander checkout, or opencode listening on 5173).
#
# Constraints:
#   - ONLY stops (never starts anything).
#   - Single confirmation (except with -y).
#   - Does not stop Hermes: only api / database / frontend.

set -uo pipefail

# ---------------------------------------------------------------------------
# Path resolution + source common.sh
# ---------------------------------------------------------------------------
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$ROOT/lib/common.sh"

# ---------------------------------------------------------------------------
# Configuration (overridable via environment)
# ---------------------------------------------------------------------------
API_PORT="${API_PORT:-4310}"          # Fastify backend port
WEB_PORT="${WEB_PORT:-5173}"          # Vite frontend port (dev)
DATA_DIR="$ROOT/data"
API_PID_FILE="$DATA_DIR/api.pid"
WEB_PID_FILE="$DATA_DIR/web.pid"
GRACE_SECS="${GRACE_SECS:-5}"         # seconds to wait before SIGKILL

# ---------------------------------------------------------------------------
# Flags
# ---------------------------------------------------------------------------
ASSUME_YES=0
case "${1:-}" in
  -y|--yes) ASSUME_YES=1 ;;
  -h|--help)
    sed -n '2,20p' "$0"
    exit 0
    ;;
esac

# ---------------------------------------------------------------------------
# Repo-scoped detection
# ---------------------------------------------------------------------------

# find_api_pids — PIDs of THIS repo's backend: those registered in the PID file
# that are still alive, plus those listening on API_PORT with cwd under ROOT.
find_api_pids() {
  local pids=""
  pids="$pids $(pid_file_pid "$API_PID_FILE")"
  pids="$pids $(pids_on_port_for_repo "$API_PORT" "$ROOT")"
  dedupe_pids "$pids"
}

# find_web_pids — PIDs of THIS repo's frontend (PID file + port with cwd under ROOT).
find_web_pids() {
  local pids=""
  pids="$pids $(pid_file_pid "$WEB_PID_FILE")"
  pids="$pids $(pids_on_port_for_repo "$WEB_PORT" "$ROOT")"
  dedupe_pids "$pids"
}

# db_backend — prints the database mechanism:
#   'docker'   → there is a docker-compose with a DB service
#   'embedded' → SQLite embedded in the API (no separate process)
#   'none'     → no detectable database
db_backend() {
  local compose
  for compose in "$ROOT/docker-compose.yml" "$ROOT/docker-compose.yaml" "$ROOT/compose.yml" "$ROOT/compose.yaml"; do
    if [ -f "$compose" ]; then
      printf '%s\n' 'docker'
      return 0
    fi
  done
  # No docker-compose: embedded SQLite (better-sqlite3) lives inside the API process.
  printf '%s\n' 'embedded'
  return 0
}

# ---------------------------------------------------------------------------
# Stopping
# ---------------------------------------------------------------------------

# stop_api — stops the backend and cleans up the PID file.
stop_api() {
  local pid ok=1
  for pid in $(find_api_pids); do
    if stop_pid "$pid" "$GRACE_SECS"; then
      ok=0
    fi
  done
  rm -f "$API_PID_FILE"
  return "$ok"
}

# stop_web — stops the Vite frontend and cleans up the PID file.
stop_web() {
  local pid ok=1
  for pid in $(find_web_pids); do
    if stop_pid "$pid" "$GRACE_SECS"; then
      ok=0
    fi
  done
  rm -f "$WEB_PID_FILE"
  return "$ok"
}

# stop_db — stops the database according to its mechanism.
stop_db() {
  case "$(db_backend)" in
    docker)
      if is_installed docker; then
        if docker compose -f "$ROOT/docker-compose.yml" down 2>/dev/null \
           || docker-compose -f "$ROOT/docker-compose.yml" down 2>/dev/null; then
          return 0
        fi
      fi
      return 1
      ;;
    embedded)
      # Embedded SQLite: stops together with the API. Nothing to do here.
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Confirmation
# ---------------------------------------------------------------------------

# confirm <message> — asks for confirmation unless -y was passed.
confirm() {
  local msg="$1"
  if [ "$ASSUME_YES" -eq 1 ]; then
    return 0
  fi
  ask_confirm "$msg"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

print_status "Hermes Commander — service shutdown"

# --- Detection ---
api_pids="$(find_api_pids)"
web_pids="$(find_web_pids)"
db_kind="$(db_backend)"

# The database "runs" if it is docker (container) or if it is embedded and the
# API is alive (SQLite lives inside the API process).
db_running=0
if [ "$db_kind" = 'docker' ]; then
  if is_installed docker && docker compose -f "$ROOT/docker-compose.yml" ps -q 2>/dev/null | grep -q .; then
    db_running=1
  fi
elif [ "$db_kind" = 'embedded' ] && [ -n "$api_pids" ]; then
  db_running=1
fi

# --- If nothing is running, exit cleanly (no confirmation) ---
if [ -z "$api_pids" ] && [ -z "$web_pids" ] && [ "$db_running" -eq 0 ]; then
  print_ok "No services running"
  exit 0
fi

# --- Single confirmation before any destructive action ---
echo
print_status "Services from this repo running:"
[ -n "$api_pids" ] && print_status "  API:      pid(s) $(echo "$api_pids" | tr '\n' ' ')"
[ -n "$web_pids" ] && print_status "  Frontend: pid(s) $(echo "$web_pids" | tr '\n' ' ')"
if [ "$db_running" -eq 1 ]; then
  print_status "  Database: $( [ "$db_kind" = 'docker' ] && echo 'docker container' || echo 'embedded SQLite (with the API)' )"
fi

if ! confirm "Stop Hermes Commander services?"; then
  print_warn "Nothing was stopped (cancelled)."
  exit 0
fi

# --- Stop each service ---
stopped=0
failed=0

# API
if [ -n "$api_pids" ]; then
  if stop_api; then
    print_ok "API stopped"
    stopped=$((stopped + 1))
  else
    print_error "Could not stop the API"
    failed=$((failed + 1))
  fi
fi

# Database
if [ "$db_running" -eq 1 ]; then
  if stop_db; then
    if [ "$db_kind" = 'embedded' ]; then
      print_ok "Database stopped (embedded SQLite, with the API)"
    else
      print_ok "Database stopped"
    fi
    stopped=$((stopped + 1))
  else
    print_error "Could not stop the database"
    failed=$((failed + 1))
  fi
fi

# Frontend
if [ -n "$web_pids" ]; then
  if stop_web; then
    print_ok "Frontend stopped"
    stopped=$((stopped + 1))
  else
    print_error "Could not stop the frontend"
    failed=$((failed + 1))
  fi
fi

# --- Summary ---
echo ""
print_status "Summary: $stopped stopped, $failed failed"
if [ "$failed" -gt 0 ]; then
  exit 1
fi
exit 0
