#!/usr/bin/env bash
# Smoke test for lib/common.sh
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

fail=0
check() { # check <desc> <expected> <actual>
  if [ "$2" = "$3" ]; then
    printf '  PASS: %s\n' "$1"
  else
    printf '  FAIL: %s (expected %q, got %q)\n' "$1" "$2" "$3"
    fail=1
  fi
}

echo "== detect_os =="
os="$(detect_os)"
echo "  detect_os -> $os"
case "$os" in macos|linux) ;; *) echo "  FAIL: unexpected OS"; fail=1;; esac

echo "== is_installed =="
is_installed bash; check "is_installed bash (true)" 0 $?
is_installed __definitely_missing_cmd_xyz__; check "is_installed missing (false)" 1 $?

echo "== get_version =="
v="$(get_version bash)"
echo "  get_version bash -> $v"
[ -n "$v" ] && echo "  PASS: get_version returned non-empty" || { echo "  FAIL: get_version empty"; fail=1; }

echo "== is_running =="
is_running "bash"; check "is_running bash (true)" 0 $?
is_running "__no_such_process_pattern_xyz__"; check "is_running missing (false)" 1 $?

echo "== print_* (no-color, piped) =="
print_status "status line"
print_ok "ok line"
print_warn "warn line"
print_error "error line"

echo "== sed_i =="
tmpf="$(mktemp)"
printf 'hello world\n' > "$tmpf"
sed_i 's/world/there/' "$tmpf"
check "sed_i in-place edit" "hello there" "$(cat "$tmpf")"
rm -f "$tmpf"

echo "== pkg_manager =="
pm="$(pkg_manager)" && echo "  pkg_manager -> $pm" || echo "  pkg_manager -> (none)"

echo "== ask_confirm (EOF -> no) =="
if ask_confirm "proceed?" </dev/null; then echo "  FAIL: EOF should be no"; fail=1; else echo "  PASS: EOF -> no"; fi

echo ""
if [ "$fail" -eq 0 ]; then echo "ALL SMOKE TESTS PASSED"; else echo "SOME TESTS FAILED"; fi
exit $fail
