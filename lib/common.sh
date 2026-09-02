#!/usr/bin/env bash
# common.sh — shared helpers for Hermes Commander scripts.
#
# Sourced (not executed) by the other scripts in this repo:
#   source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
#
# Constraints:
#   - Pure bash, no external dependencies.
#   - Compatible with bash 3.2 (macOS default) and bash 4+.
#   - No associative arrays, no bash-4-only features.
#   - `set -euo pipefail` is NOT forced here: this file is sourced, and
#     forcing it would break interactive prompts (ask_confirm) and callers
#     that manage their own error handling. Callers opt in themselves.

# ---------------------------------------------------------------------------
# ANSI colors (with no-color fallback when stdout is not a TTY)
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  C_RESET='\033[0m'
  C_BOLD='\033[1m'
  C_DIM='\033[2m'
  C_RED='\033[31m'
  C_GREEN='\033[32m'
  C_YELLOW='\033[33m'
  C_BLUE='\033[34m'
  C_MAGENTA='\033[35m'
  C_CYAN='\033[36m'
else
  C_RESET=''
  C_BOLD=''
  C_DIM=''
  C_RED=''
  C_GREEN=''
  C_YELLOW=''
  C_BLUE=''
  C_MAGENTA=''
  C_CYAN=''
fi

# ---------------------------------------------------------------------------
# OS detection
# ---------------------------------------------------------------------------

# detect_os — print 'macos' or 'linux' based on `uname -s`.
# Returns 0 on success, 1 on an unsupported OS.
detect_os() {
  case "$(uname -s)" in
    Darwin)  printf '%s\n' 'macos'; return 0 ;;
    Linux)   printf '%s\n' 'linux'; return 0 ;;
    *)       printf '%s\n' 'unknown'; return 1 ;;
  esac
}

# is_macos / is_linux — boolean convenience wrappers around detect_os.
is_macos() { [ "$(detect_os)" = 'macos' ]; }
is_linux() { [ "$(detect_os)" = 'linux' ]; }

# ---------------------------------------------------------------------------
# Interactive prompt
# ---------------------------------------------------------------------------

# ask_confirm <mensaje> — prompt yes/no (default no). Reads from stdin.
# Returns 0 if the user confirms, 1 otherwise (including EOF / empty input).
# Robust: reads a single line, trims whitespace, accepts y/yes/si/s (case
# insensitive). Anything else (or EOF) is treated as "no".
ask_confirm() {
  local msg="${1:-Continue?}"
  local answer
  printf '%s [y/N] ' "$msg" >&2
  if ! IFS= read -r answer; then
    # EOF on stdin → treat as "no".
    printf '\n' >&2
    return 1
  fi
  case "$answer" in
    [yY]|[yY][eE][sS]|[sS][iI]|[sS]) return 0 ;;
    *) return 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# Binary / version helpers
# ---------------------------------------------------------------------------

# is_installed <comando> — true (0) if the binary is on PATH, else 1.
is_installed() {
  [ -n "${1:-}" ] && command -v "$1" >/dev/null 2>&1
}

# node_modules_present <repo_root> — true (0) if node_modules exists at the
# repo root (project dependencies installed). Returns 1 otherwise.
node_modules_present() {
  local root="${1:-}"
  [ -n "$root" ] && [ -d "$root/node_modules" ]
}

# npm_ci <repo_root> — run `npm ci` in the repo root. Returns npm's exit code.
npm_ci() {
  local root="${1:-}"
  [ -n "$root" ] || return 1
  ( cd "$root" && npm ci )
}

# get_version <comando> — best-effort version string.
# Tries `--version` then `-v`, capturing stdout+stderr and taking the first
# non-empty line. Prints nothing and returns 1 if the command is missing or
# produces no usable output. Never fails the caller (safe under set -e).
get_version() {
  local cmd="${1:-}"
  local out
  [ -n "$cmd" ] || return 1
  command -v "$cmd" >/dev/null 2>&1 || return 1
  out="$( "$cmd" --version 2>&1 || "$cmd" -v 2>&1 || true )"
  out="$( printf '%s\n' "$out" | sed -n '1p' )"
  [ -n "$out" ] || return 1
  printf '%s\n' "$out"
  return 0
}

# ---------------------------------------------------------------------------
# Process detection
# ---------------------------------------------------------------------------

# is_running <pattern> — true (0) if a process matching the pattern is running.
# Uses `pgrep -f` (full command line). Returns 1 if pgrep is missing or no
# match. The pattern is passed verbatim to pgrep -f.
is_running() {
  local pattern="${1:-}"
  [ -n "$pattern" ] || return 1
  command -v pgrep >/dev/null 2>&1 || return 1
  pgrep -f "$pattern" >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# Repo-scoped process detection
#
# The helpers below let scripts identify the *specific* process that belongs to
# a given repo, instead of matching broad `pgrep -f` patterns that can hit
# other projects (e.g. another hermes-commander checkout, or unrelated tools like
# opencode that happen to listen on the same port). The rule is: a process
# belongs to a repo if its working directory (cwd) is under the repo root, or
# its command line references the repo root. Ports alone are never enough —
# another process may be bound to the same port.
# ---------------------------------------------------------------------------

# pid_cwd <pid> — prints the working directory of a process, or nothing.
# Uses lsof (macOS/Linux) or /proc/<pid>/cwd (Linux). Returns 1 if unknown.
pid_cwd() {
  local pid="${1:-}"
  [ -n "$pid" ] || return 1
  if command -v lsof >/dev/null 2>&1; then
    lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1
    return 0
  fi
  if [ -r "/proc/$pid/cwd" ]; then
    readlink "/proc/$pid/cwd" 2>/dev/null
    return 0
  fi
  return 1
}

# pid_cmdline <pid> — prints the full command line of a process, or nothing.
pid_cmdline() {
  local pid="${1:-}"
  [ -n "$pid" ] || return 1
  ps -p "$pid" -o command= 2>/dev/null
}

# pid_alive <pid> — true (0) if the process exists and is alive.
pid_alive() {
  local pid="${1:-}"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null
}

# pids_on_port <puerto> — prints the PIDs listening on a TCP port (one per
# line). Uses lsof on macOS, ss/fuser on Linux. Returns 1 if none found.
pids_on_port() {
  local port="${1:-}"
  [ -n "$port" ] || return 1
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null
    return 0
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp 2>/dev/null | awk -v p=":$port" '
      $4 ~ p { for (i=1;i<=NF;i++) if ($i ~ /pid=/) { sub(/.*pid=/,"",$i); sub(/,.*/,"",$i); print $i } }'
    return 0
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser "$port"/tcp 2>/dev/null | tr ' ' '\n'
    return 0
  fi
  return 1
}

# pid_belongs_to_repo <pid> <repo_root> — true (0) if the process's cwd is
# under repo_root, or its command line references repo_root. This is the
# repo-scoping check that prevents killing another project's process that
# happens to share a port or a similar command line.
pid_belongs_to_repo() {
  local pid="${1:-}" root="${2:-}"
  [ -n "$pid" ] && [ -n "$root" ] || return 1
  local cwd cmd
  cwd="$(pid_cwd "$pid")"
  if [ -n "$cwd" ]; then
    case "$cwd" in
      "$root"|"$root"/*) return 0 ;;
    esac
  fi
  cmd="$(pid_cmdline "$pid")"
  if [ -n "$cmd" ]; then
    case "$cmd" in
      *"$root"*) return 0 ;;
    esac
  fi
  return 1
}

# pids_on_port_for_repo <puerto> <repo_root> — prints the PIDs listening on the
# port that ALSO belong to the repo. Never returns a PID from another project.
pids_on_port_for_repo() {
  local port="${1:-}" root="${2:-}" pid
  [ -n "$port" ] && [ -n "$root" ] || return 1
  for pid in $(pids_on_port "$port"); do
    if pid_belongs_to_repo "$pid" "$root"; then
      printf '%s\n' "$pid"
    fi
  done
}

# pid_file_pid <pidfile> — prints the PID stored in a pidfile if that process
# is alive, else nothing. Returns 1 if the file is missing or the PID is dead.
pid_file_pid() {
  local file="${1:-}" pid
  [ -n "$file" ] && [ -f "$file" ] || return 1
  pid="$(cat "$file" 2>/dev/null)"
  [ -n "$pid" ] || return 1
  if pid_alive "$pid"; then
    printf '%s\n' "$pid"
    return 0
  fi
  return 1
}

# dedupe_pids <lista> — prints unique, valid (numeric) PIDs, one per line.
dedupe_pids() {
  printf '%s\n' "$@" | tr ' ' '\n' | grep -E '^[0-9]+$' | sort -un
}

# stop_pid <pid> <grace_secs> — SIGTERM, wait up to grace_secs, then SIGKILL.
# Returns 0 if the process is gone (or was already gone), 1 on failure.
stop_pid() {
  local pid="${1:-}" grace="${2:-5}" waited=0
  [ -n "$pid" ] || return 1
  if ! pid_alive "$pid"; then
    return 0   # already gone
  fi
  kill "$pid" 2>/dev/null || return 1
  while pid_alive "$pid" && [ "$waited" -lt "$grace" ]; do
    sleep 1
    waited=$((waited + 1))
  done
  if pid_alive "$pid"; then
    kill -9 "$pid" 2>/dev/null || return 1
  fi
  return 0
}


# ---------------------------------------------------------------------------
# Status / log output
# ---------------------------------------------------------------------------

# print_status <mensaje> — neutral status line.
print_status() { printf "${C_BLUE}==>${C_RESET} %s\n" "$*"; }

# print_ok <mensaje> — success line.
print_ok()     { printf "${C_GREEN}✔${C_RESET} %s\n" "$*"; }

# print_warn <mensaje> — warning line (to stderr).
print_warn()   { printf "${C_YELLOW}⚠${C_RESET} %s\n" "$*" >&2; }

# print_error <mensaje> — error line (to stderr).
print_error()  { printf "${C_RED}✘${C_RESET} %s\n" "$*" >&2; }

# ---------------------------------------------------------------------------
# Cross-platform command adaptation
# ---------------------------------------------------------------------------

# sed_i <file> <expression> — in-place edit that works on both macOS and
# Linux. macOS `sed -i` requires an explicit backup suffix; GNU sed does not.
# Usage: sed_i 's/foo/bar/' file.txt
sed_i() {
  local expr="${1:-}"
  local file="${2:-}"
  [ -n "$expr" ] && [ -n "$file" ] || return 1
  if [ "$(detect_os)" = 'macos' ]; then
    sed -i '' "$expr" "$file"
  else
    sed -i "$expr" "$file"
  fi
}

# pkg_manager — print the name of the available package manager, or return 1.
# macOS → brew; Linux → apt-get (Debian/Ubuntu), dnf (Fedora/RHEL), yum
# (older RHEL/CentOS), apk (Alpine). First match wins.
pkg_manager() {
  case "$(detect_os)" in
    macos)
      command -v brew >/dev/null 2>&1 && { printf '%s\n' 'brew'; return 0; }
      ;;
    linux)
      if   command -v apt-get >/dev/null 2>&1; then printf '%s\n' 'apt-get'; return 0
      elif command -v dnf     >/dev/null 2>&1; then printf '%s\n' 'dnf';     return 0
      elif command -v yum     >/dev/null 2>&1; then printf '%s\n' 'yum';     return 0
      elif command -v apk     >/dev/null 2>&1; then printf '%s\n' 'apk';     return 0
      fi
      ;;
  esac
  return 1
}

# pkg_install <paquete...> — install one or more packages using the detected
# package manager. Returns the manager's exit code, or 1 if none is found.
pkg_install() {
  local pm
  pm="$(pkg_manager)" || { print_error "No supported package manager found."; return 1; }
  case "$pm" in
    brew)    brew install "$@" ;;
    apt-get) sudo apt-get install -y "$@" ;;
    dnf)     sudo dnf install -y "$@" ;;
    yum)     sudo yum install -y "$@" ;;
    apk)     sudo apk add "$@" ;;
    *)       print_error "Unsupported package manager: $pm"; return 1 ;;
  esac
}
