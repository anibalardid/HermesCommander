#!/usr/bin/env bash
# verify_node_guard.sh — unit-test the node_version_ok() guard (copied verbatim
# from install.sh) against a matrix of Node versions, using a fake `node` shim.
set -uo pipefail

# --- copied verbatim from install.sh (lines 134-143) ---
node_version_ok() {
  local node_bin="${1:-node}" ver major
  command -v "$node_bin" >/dev/null 2>&1 || return 1
  ver="$( "$node_bin" --version 2>/dev/null )" || return 1
  major="${ver#v}"; major="${major%%.*}"
  case "$major" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$major" -ge 20 ] && [ "$major" -lt 26 ]
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Node version guard matrix (node_version_ok):"
for v in 18.0.0 20.0.0 22.16.0 24.9.0 25.0.0 26.7.0 30.0.0; do
  shim="$TMP/node-$v"
  printf '#!/bin/sh\necho "v%s"\n' "$v" > "$shim"
  chmod +x "$shim"
  if node_version_ok "$shim"; then
    printf '  node %-8s -> ACCEPTED\n' "$v"
  else
    printf '  node %-8s -> REJECTED\n' "$v"
  fi
done
