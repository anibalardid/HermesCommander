#!/usr/bin/env bash
# setup-terminal.sh — verify & install the prerequisites for the embedded Hermes
# TUI terminal (xterm.js in the Hermes Commander web app).
#
# The TUI tab spawns `hermes --tui -p <profile> --in <cwd>` through a python pty
# helper. Both python3 and the `hermes` CLI must be present ON THE HOST where
# the Hermes Commander server runs (Mac or Linux) and reachable from the server's PATH.
#
# Usage:
#   ./setup-terminal.sh        # check + report what's missing
#   ./setup-terminal.sh --fix  # attempt to install what's missing
#
# Works on macOS and Linux. Run from the repo root (deploy/).

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER="$ROOT/apps/server/src/terminal/pty-helper.py"

FIX=0
[[ "${1:-}" == "--fix" ]] && FIX=1

echo "== Hermes Commander embedded-terminal prerequisites =="

# --- 1. python3 (stdlib only: pty, os, sys, signal) ---
PYOK=0
if command -v python3 >/dev/null 2>&1; then
  PYVER="$(python3 --version 2>&1)"
  # Check the helper at least parses (stdlib only → 3.7+).
  if python3 -c "import ast,sys; ast.parse(open('$HELPER').read())" 2>/dev/null; then
    echo "  [ok] python3  ($PYVER, helper parses)"
    PYOK=1
  else
    echo "  [!!] python3 present ($PYVER) but cannot parse the PTY helper"
  fi
else
  echo "  [!!] python3 NOT found"
fi

# --- 2. hermes CLI (the actual TUI binary) ---
HERMESOK=0
if command -v hermes >/dev/null 2>&1; then
  echo "  [ok] hermes  ($(hermes --version 2>&1 | head -1))"
  HERMESOK=1
else
  echo "  [!!] hermes CLI NOT found on PATH"
fi

# --- 3. helper file present ---
HELPOK=0
if [ -f "$HELPER" ]; then
  echo "  [ok] PTY helper present ($HELPER)"
  HELPOK=1
else
  echo "  [!!] PTY helper missing ($HELPER) — did you clone the repo fully?"
fi

echo
if [[ "$PYOK" -eq 1 && "$HERMESOK" -eq 1 && "$HELPOK" -eq 1 ]]; then
  echo "✅ All prerequisites satisfied — the Terminal tab will work."
  exit 0
fi

# --- Fix mode ---
if [[ "$FIX" -eq 1 ]]; then
  echo "Attempting to install missing pieces..."
  if [[ "$PYOK" -eq 0 ]]; then
    echo "  Installing python3..."
    if [ "$(uname -s)" = "Darwin" ]; then
      if command -v brew >/dev/null 2>&1; then
        brew install python
      else
        echo "    Homebrew not found. Install it: https://brew.sh then re-run with --fix."
      fi
    elif command -v apt-get >/dev/null 2>&1; then
      sudo apt-get update && sudo apt-get install -y python3
    elif command -v yum >/dev/null 2>&1; then
      sudo yum install -y python3
    else
      echo "    Unsupported package manager. Install python3 manually."
    fi
  fi
  if [[ "$HERMESOK" -eq 0 ]]; then
    echo "  The hermes CLI must be installed and on PATH."
    echo "  See https://hermes-agent.nousresearch.com/docs for install instructions."
  fi
  echo "  Re-run without --fix to confirm."
  exit 1
fi

echo
echo "Missing prerequisites. Install them (see deploy/README + docs/09-tui-terminal.md)"
echo "or run:  $0 --fix"
exit 1
