#!/usr/bin/env bash
# install.sh — validate & install Hermes Commander host requirements.
#
# Sources lib/common.sh, discovers the project's real dependencies, reports
# which are installed (with version) vs missing, and offers to install each
# missing one INDIVIDUALLY (one ask_confirm per item). Never installs anything
# without explicit confirmation, and never installs in batch.
#
# Usage:
#   ./install.sh            # check + report, then offer to install missing items
#   ./install.sh --dry-run  # same flow, but only PRINT the install commands
#                           # (never executes them)
#
# Works on macOS (brew) and Linux (apt-get/dnf/yum/apk). Handles the case where
# no supported package manager exists with a clear error.

set -uo pipefail

# Resolve the repo root and source the shared helpers.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT/lib/common.sh"

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

# ---------------------------------------------------------------------------
# Requirement table
# ---------------------------------------------------------------------------
# One line per requirement, fields separated by '|':
#   name | binary | version_cmd | required | brew_pkg | apt_pkg | dnf_pkg | note
#
#   name         — human-readable name.
#   binary       — command checked with `command -v`.
#   version_cmd  — flag/subcommand used to print the version (empty = --version).
#   required     — 1 = hard requirement, 0 = optional (recommended).
#   brew_pkg     — Homebrew formula (macOS).
#   apt_pkg      — Debian/Ubuntu package.
#   dnf_pkg      — Fedora/RHEL package.
#   note         — empty = normal package install; otherwise "manual:<text>"
#                  means there is no package-manager install and <text> is shown.
#
# Discovered from the repo (package.json engines, deploy/, docs/):
#   - node >=20 + npm (npm workspaces, engines.node)
#   - python3 (stdlib-only PTY helper for the embedded terminal)
#   - git (worktrees, clone, source control)
#   - gh (optional — PR creation only; commit/push work without it)
#   - hermes (the orchestrator + TUI terminal binary)
#   - tailscale (optional — remote mobile access)
# NOTE: docker is NOT a dependency — no Dockerfile/docker-compose in the repo.
REQUIREMENTS=(
  "node|node||1|node|nodejs|nodejs|"
  "npm|npm||1|||nodejs|manual:bundled with node (no separate install)"
  "python3|python3||1|python|python3|python3|"
  "git|git||1|git|git|git|"
  "gh|gh||0|gh|gh|gh|"
  "hermes|hermes||1||||manual:see https://hermes-agent.nousresearch.com/docs"
  "tailscale|tailscale|version|0|tailscale|||manual:see https://tailscale.com/download"
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# req_version <binary> <version_cmd> — best-effort version string (first line).
# Prints nothing and returns 1 if the binary is missing or yields no output.
req_version() {
  local bin="${1:-}" vcmd="${2:-}"
  local out
  command -v "$bin" >/dev/null 2>&1 || return 1
  if [ -n "$vcmd" ]; then
    out="$( "$bin" "$vcmd" 2>&1 || true )"
  else
    out="$( "$bin" --version 2>&1 || "$bin" -v 2>&1 || true )"
  fi
  out="$( printf '%s\n' "$out" | sed -n '1p' )"
  [ -n "$out" ] || return 1
  printf '%s\n' "$out"
  return 0
}

# pm_install_cmd <pkg> — print the exact install command for the current PM.
# Returns 1 (and prints nothing) if no supported package manager is found.
pm_install_cmd() {
  local pkg="${1:-}" pm
  [ -n "$pkg" ] || return 1
  pm="$(pkg_manager)" || return 1
  case "$pm" in
    brew)    printf 'brew install %s' "$pkg" ;;
    apt-get) printf 'sudo apt-get install -y %s' "$pkg" ;;
    dnf)     printf 'sudo dnf install -y %s' "$pkg" ;;
    yum)     printf 'sudo yum install -y %s' "$pkg" ;;
    apk)     printf 'sudo apk add %s' "$pkg" ;;
    *)       return 1 ;;
  esac
}

# pm_run_install <pkg> — actually run the install via the detected PM.
pm_run_install() {
  local pkg="${1:-}" pm
  [ -n "$pkg" ] || return 1
  pm="$(pkg_manager)" || { print_error "No supported package manager found."; return 1; }
  case "$pm" in
    brew)    brew install "$pkg" ;;
    apt-get) sudo apt-get install -y "$pkg" ;;
    dnf)     sudo dnf install -y "$pkg" ;;
    yum)     sudo yum install -y "$pkg" ;;
    apk)     sudo apk add "$pkg" ;;
    *)       print_error "Unsupported package manager: $pm"; return 1 ;;
  esac
}

# pkg_for <name> <brew> <apt> <dnf> — pick the package name for the current PM.
pkg_for() {
  local name="${1:-}" brew_pkg="${2:-}" apt_pkg="${3:-}" dnf_pkg="${4:-}"
  local pm
  pm="$(pkg_manager)" || return 1
  case "$pm" in
    brew)    [ -n "$brew_pkg" ] && { printf '%s\n' "$brew_pkg"; return 0; } ;;
    apt-get) [ -n "$apt_pkg" ]  && { printf '%s\n' "$apt_pkg";  return 0; } ;;
    dnf|yum) [ -n "$dnf_pkg" ]  && { printf '%s\n' "$dnf_pkg";  return 0; } ;;
    apk)     [ -n "$apt_pkg" ]  && { printf '%s\n' "$apt_pkg";  return 0; } ;;
  esac
  return 1
}

# ---------------------------------------------------------------------------
# Node version guard
# ---------------------------------------------------------------------------
# better-sqlite3 (native addon) does not yet support Node 26: its V8 API
# changed incompatibly, so `npm ci` would fall back to a source build that
# fails. Reject Node >=26 with a clear error instead of a cryptic gyp failure.
# Supported range mirrors `engines.node` in package.json (">=20 <26").
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

# ---------------------------------------------------------------------------
# Main flow
# ---------------------------------------------------------------------------

print_status "Hermes Commander — host requirements"
echo "OS: $(detect_os) | Package manager: $(pkg_manager 2>/dev/null || echo 'NONE')"
if [ "$DRY_RUN" -eq 1 ]; then
  print_warn "DRY-RUN: install commands will be shown but NOT executed."
fi
echo

# Reject an unsupported Node major up front (see node_version_ok above).
if ! node_version_ok node; then
  print_error "Unsupported Node version: $(node --version 2>/dev/null || echo 'not found')."
  echo "  Hermes Commander requires Node >=20 and <26 (better-sqlite3 has no"
  echo "  prebuild for Node 26 yet). Install Node 20 or 22 LTS, e.g.:"
  echo "    nvm install 22 && nvm use 22"
  echo "  then re-run ./install.sh."
  exit 1
fi

# Pass 1: check every requirement, collect installed/missing.
installed=()
missing=()
missing_required=()
missing_optional=()

for line in "${REQUIREMENTS[@]}"; do
  IFS='|' read -r name bin vcmd req brew_pkg apt_pkg dnf_pkg note <<<"$line"
  ver="$(req_version "$bin" "$vcmd")"
  if [ -n "$ver" ]; then
    installed+=("$name")
    printf "  ${C_GREEN}✔${C_RESET} %-10s %s\n" "$name" "$ver"
  else
    missing+=("$name")
    if [ "$req" = "1" ]; then
      missing_required+=("$name")
      printf "  ${C_RED}✘${C_RESET} %-10s ${C_RED}missing${C_RESET} (required)\n" "$name"
    else
      missing_optional+=("$name")
      printf "  ${C_YELLOW}⚠${C_RESET} %-10s ${C_YELLOW}missing${C_RESET} (optional)\n" "$name"
    fi
  fi
done

echo
# Summary.
printf "Installed: %s\n" "$(IFS=,; echo "${installed[*]:-—}")"
printf "Missing:   %s\n" "$(IFS=,; echo "${missing[*]:-—}")"
echo

# ---------------------------------------------------------------------------
# Project dependencies (npm ci)
# ---------------------------------------------------------------------------
# node_modules is gitignored, so a fresh clone has no dependencies installed.
# Offer to run `npm ci` (installs exactly what package-lock.json pins) when the
# repo's node_modules is missing. This is separate from the host requirements
# above: node/npm are host tools, node_modules is this project's install.
print_status "Project dependencies (npm ci)"
if node_modules_present "$ROOT"; then
  print_ok "node_modules present — dependencies already installed."
else
  print_warn "node_modules not found — project dependencies are not installed."
  if [ "$DRY_RUN" -eq 1 ]; then
    print_warn "  [dry-run] would run: npm ci"
  elif ask_confirm "Run 'npm ci' to install project dependencies?"; then
    print_status "Installing project dependencies (npm ci)..."
    if npm_ci "$ROOT"; then
      print_ok "Project dependencies installed."
    else
      print_error "npm ci failed (exit $?)."
    fi
  else
    print_warn "Skipped — dependencies not installed. Run './install.sh' again or 'npm ci'."
  fi
fi
echo

if [ "${#missing[@]}" -eq 0 ]; then
  print_ok "All requirements satisfied."
  exit 0
fi

# Pass 2: offer to install each missing item individually.
for line in "${REQUIREMENTS[@]}"; do
  IFS='|' read -r name bin vcmd req brew_pkg apt_pkg dnf_pkg note <<<"$line"
  # Skip items that are already installed.
  [ -n "$(req_version "$bin" "$vcmd")" ] && continue

  echo "──────────────────────────────────────────────"
  if [ "$req" = "1" ]; then
    print_status "Missing (required): $name"
  else
    print_status "Missing (optional): $name"
  fi

  # Determine the install action.
  if [ "${note#manual:}" != "$note" ]; then
    # Manual install — no package-manager command.
    echo "  No package-manager install available."
    echo "  ${note#manual:}"
    if ask_confirm "Mark $name as handled manually? (no install will be run)"; then
      print_ok "$name — noted (manual install)."
    else
      print_warn "$name — skipped."
    fi
    continue
  fi

  # Normal package install.
  if ! pkg_manager >/dev/null 2>&1; then
    print_error "No supported package manager found — cannot install '$name'."
    echo "  Install a package manager first (e.g. Homebrew on macOS: https://brew.sh)"
    echo "  or install '$name' manually."
    continue
  fi

  pkg="$(pkg_for "$name" "$brew_pkg" "$apt_pkg" "$dnf_pkg")"
  if [ -z "$pkg" ]; then
    print_error "No package available for '$name' on this OS/package manager."
    continue
  fi

  cmd="$(pm_install_cmd "$pkg")"
  if [ -z "$cmd" ]; then
    print_error "No supported package manager found — cannot install '$name'."
    echo "  Install a package manager first (e.g. Homebrew on macOS: https://brew.sh)"
    echo "  or install '$name' manually."
    continue
  fi

  echo "  Command: $cmd"
  if ask_confirm "Install $name?"; then
    if [ "$DRY_RUN" -eq 1 ]; then
      print_warn "  [dry-run] would run: $cmd"
    else
      print_status "Installing $name..."
      if pm_run_install "$pkg"; then
        print_ok "$name installed."
      else
        print_error "$name install failed (exit $?)."
      fi
    fi
  else
    print_warn "$name — skipped."
  fi
done

# Pass 3: final summary — re-check what's now installed vs still missing.
echo
print_status "Final summary"
still_missing=()
now_installed=()
for line in "${REQUIREMENTS[@]}"; do
  IFS='|' read -r name bin vcmd req brew_pkg apt_pkg dnf_pkg note <<<"$line"
  if [ -n "$(req_version "$bin" "$vcmd")" ]; then
    now_installed+=("$name")
  else
    still_missing+=("$name")
  fi
done

printf "Installed: %s\n" "$(IFS=,; echo "${now_installed[*]:-—}")"
printf "Missing:   %s\n" "$(IFS=,; echo "${still_missing[*]:-—}")"

if [ "${#still_missing[@]}" -eq 0 ]; then
  print_ok "All requirements satisfied."
  exit 0
fi

# Distinguish hard vs optional in the final missing list.
print_warn "Still missing:"
for line in "${REQUIREMENTS[@]}"; do
  IFS='|' read -r name bin vcmd req brew_pkg apt_pkg dnf_pkg note <<<"$line"
  [ -n "$(req_version "$bin" "$vcmd")" ] && continue
  if [ "$req" = "1" ]; then
    print_error "  $name (required)"
  else
    print_warn "  $name (optional)"
  fi
done
exit 1
