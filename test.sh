#!/usr/bin/env bash
# test.sh — configure a test database and run the project's test suite.
#
# Flow:
#   1. Source lib/common.sh (shared helpers).
#   2. Detect the repo root, the test runner, and the test DB path.
#   3. Ensure dependencies are installed (offer `npm install` if missing).
#   4. Configure the test DB — with a confirmation before each effect:
#        - run migrations (schema + additive migrations)
#        - load test seed data
#   5. Validate the DB state (tables + row counts) and report.
#   6. Run the test suite — with confirmation — and report pass/fail.
#
# Safety:
#   - Uses a dedicated test DB on a THROWAWAY path (a temp dir created with
#     `mktemp -d`), never the production data/hermes-commander.db. The temp dir is
#     removed on success AND on failure/interrupt (trap), so no throwaway
#     state is left behind on any exit path.
#   - Every effectful step asks for confirmation.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

# The scripts/ directory is itself the monorepo root (a git worktree checkout
# containing package.json, apps/, lib/, docs/). Resolve it robustly.
REPO_ROOT="$SCRIPT_DIR"
SERVER_DIR="$REPO_ROOT/apps/server"
WEB_DIR="$REPO_ROOT/apps/web"

# Local binaries (hoisted to the monorepo root by npm workspaces).
TSX="$REPO_ROOT/node_modules/.bin/tsx"
VITEST="$REPO_ROOT/node_modules/.bin/vitest"

# ---------------------------------------------------------------------------
# Throwaway test DB
# ---------------------------------------------------------------------------
# Create a dedicated temp dir for the test DB. It is removed on every exit
# path (success, failure, and SIGINT/SIGTERM) via the trap below, so it never
# clobbers the real DB and never leaves throwaway state behind.
TEST_DB_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hermes-commander-test.XXXXXX")" || {
  print_error "Could not create the temporary directory for the test database."
  exit 1
}
TEST_DB="$TEST_DB_DIR/test.db"

cleanup() {
  rm -rf "$TEST_DB_DIR" 2>/dev/null
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# Detection helpers
# ---------------------------------------------------------------------------

# detect_test_runner — print the test runner name, or return 1.
# Order: explicit root `test` script → vitest → jest → pytest.
detect_test_runner() {
  if [ -f "$REPO_ROOT/package.json" ] && grep -q '"test"[[:space:]]*:' "$REPO_ROOT/package.json"; then
    printf '%s\n' 'npm'
    return 0
  fi
  if [ -x "$REPO_ROOT/node_modules/.bin/vitest" ] || grep -q '"vitest"' "$SERVER_DIR/package.json" 2>/dev/null; then
    printf '%s\n' 'vitest'
    return 0
  fi
  if [ -x "$REPO_ROOT/node_modules/.bin/jest" ]; then
    printf '%s\n' 'jest'
    return 0
  fi
  if is_installed pytest; then
    printf '%s\n' 'pytest'
    return 0
  fi
  return 1
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

print_status "Hermes Commander test runner"
print_status "Repo root: $REPO_ROOT"
print_status "Test DB:   $TEST_DB (throwaway, removed on exit)"

# 0. Dependencies
if [ ! -d "$REPO_ROOT/node_modules" ]; then
  print_warn "node_modules not found in $REPO_ROOT"
  if ask_confirm "Install dependencies (npm install)?"; then
    (cd "$REPO_ROOT" && npm install) || { print_error "npm install failed"; exit 1; }
  else
    print_error "Dependencies are required to run migrations and tests. Aborting."
    exit 1
  fi
fi

# 1. Configure the test DB
if ask_confirm "Configure the test database?"; then
  # 1a. Migrations
  if ask_confirm "Run migrations?"; then
    print_status "Running migrations on $TEST_DB ..."
    if HERMES_COMMANDER_DB="$TEST_DB" "$TSX" "$SCRIPT_DIR/lib/db.mts" migrate; then
      print_ok "Migrations applied."
    else
      print_error "Migrations failed."
      exit 1
    fi
  else
    print_warn "Migrations skipped."
  fi

  # 1b. Seed
  if ask_confirm "Load test seed data?"; then
    print_status "Seeding test data ..."
    if HERMES_COMMANDER_DB="$TEST_DB" "$TSX" "$SERVER_DIR/src/seed.ts"; then
      print_ok "Seed complete."
    else
      print_error "Seed failed."
      exit 1
    fi
  else
    print_warn "Seed skipped."
  fi

  # 2. Validate DB state
  print_status "Validating test DB state ..."
  if HERMES_COMMANDER_DB="$TEST_DB" "$TSX" "$SCRIPT_DIR/lib/db.mts" validate; then
    print_ok "DB validation complete."
  else
    print_error "DB validation failed."
    exit 1
  fi
else
  print_warn "Test DB configuration skipped."
fi

# 3. Run tests
runner="$(detect_test_runner)" || { print_error "No test runner detected."; exit 1; }
print_status "Detected test runner: $runner"

if ask_confirm "Run all tests?"; then
  print_status "Running tests ($runner) ..."
  case "$runner" in
    npm)
      (cd "$REPO_ROOT" && HERMES_COMMANDER_DB="$TEST_DB" npm test)
      status=$?
      ;;
    vitest)
      status=0
      for ws in "$SERVER_DIR" "$WEB_DIR"; do
        if [ -f "$ws/package.json" ] && grep -q '"test"[[:space:]]*:' "$ws/package.json"; then
          print_status "Running tests in apps/$(basename "$ws") ..."
          (cd "$ws" && HERMES_COMMANDER_DB="$TEST_DB" "$VITEST" run) || status=1
        fi
      done
      ;;
    jest)
      (cd "$REPO_ROOT" && npx jest)
      status=$?
      ;;
    pytest)
      (cd "$REPO_ROOT" && pytest)
      status=$?
      ;;
    *)
      print_error "Unsupported runner: $runner"
      exit 1
      ;;
  esac

  if [ "$status" -eq 0 ]; then
    print_ok "All tests passed."
  else
    print_error "Tests failed (exit code $status)."
  fi
  exit "$status"
else
  print_warn "Tests skipped."
  exit 0
fi
