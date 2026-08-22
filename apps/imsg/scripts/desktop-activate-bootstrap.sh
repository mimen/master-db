#!/usr/bin/env bash
# Bootstrap the first staged shell when the installed Comma predates Tauri activation commands.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=desktop-app-verify.sh
source "$SCRIPT_DIR/desktop-app-verify.sh"

APP="${COMMA_APP:-$HOME/Applications/Comma.app}"
STAGED="${COMMA_STAGED_APP:-${APP}.staged}"
LOCK_WAIT_TIMEOUT="${COMMA_ACTIVATION_LOCK_TIMEOUT_SECONDS:-15}"
[[ "$LOCK_WAIT_TIMEOUT" =~ ^[0-9]+$ ]] && [ "$LOCK_WAIT_TIMEOUT" -le 60 ] \
  || { printf 'activation lock wait must be between 0 and 60 seconds\n' >&2; exit 1; }
READY_TIMEOUT="${COMMA_BOOTSTRAP_READY_TIMEOUT_SECONDS:-$((LOCK_WAIT_TIMEOUT + 20))}"
[[ "$READY_TIMEOUT" =~ ^[1-9][0-9]*$ ]] \
  || { printf 'bootstrap readiness timeout must be a positive integer\n' >&2; exit 1; }
OSASCRIPT_BIN="${COMMA_OSASCRIPT_BIN:-/usr/bin/osascript}"
ACTIVATOR="$SCRIPT_DIR/desktop-activate.sh"

[ -d "$APP" ] || { printf 'canonical Comma app is missing: %s\n' "$APP" >&2; exit 1; }
[ -d "$STAGED" ] || { printf 'no staged Comma shell is available\n' >&2; exit 1; }
expected_sha="$(comma_plist_value "$STAGED" CommaSourceSHA)"
[[ "$expected_sha" =~ ^[0-9a-f]{40}$ ]] || { printf 'staged Comma shell has an invalid source SHA\n' >&2; exit 1; }
comma_verify_app "$STAGED" "$expected_sha"

binary="$APP/Contents/MacOS/$(comma_plist_value "$APP" CFBundleExecutable)"
wait_pid="$(comma_running_pids "$binary" 2>/dev/null || true)"
[[ "$wait_pid" =~ ^[0-9]+$ ]] \
  || { printf 'deploy:activate requires exactly one running canonical Comma process\n' >&2; exit 1; }
ready_file="${TMPDIR:-/tmp}/comma-activation-bootstrap-$$.ready"
rm -f "$ready_file"
activator_pid=""
handed_off=0
cleanup() {
  rm -f "$ready_file"
  if [ "$handed_off" -eq 0 ] && [ -n "$activator_pid" ]; then
    kill "$activator_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

/usr/bin/nohup /bin/zsh -c 'unset PROCID PROCID_REF PROCID_OFF; exec -a comma:activator /bin/bash "$@"' \
  comma:activator "$ACTIVATOR" \
  --app "$APP" \
  --expected-sha "$expected_sha" \
  --wait-pid "$wait_pid" \
  --ready-file "$ready_file" \
  >/dev/null 2>&1 &
activator_pid=$!

ready=0
for _ in $(seq 1 "$READY_TIMEOUT"); do
  if [ -f "$ready_file" ]; then
    ready=1
    break
  fi
  if ! kill -0 "$activator_pid" 2>/dev/null; then
    wait "$activator_pid" || true
    printf 'Comma activator exited before readiness; check ~/Library/Logs/comma-activation.log\n' >&2
    exit 1
  fi
  sleep 1
done
rm -f "$ready_file"
if [ "$ready" -ne 1 ]; then
  kill "$activator_pid" 2>/dev/null || true
  printf 'Comma activator did not become ready within %ss\n' "$READY_TIMEOUT" >&2
  exit 1
fi

bundle_id="$(comma_plist_value "$APP" CFBundleIdentifier)"
handed_off=1
if ! kill -0 "$wait_pid" 2>/dev/null; then
  printf 'Activating staged Comma shell %s; the prior process already exited\n' "$expected_sha"
  exit 0
fi
if ! "$OSASCRIPT_BIN" -e "tell application id \"$bundle_id\" to quit" >/dev/null 2>&1; then
  handed_off=0
  kill "$activator_pid" 2>/dev/null || true
  printf 'Comma activator is ready, but the running app could not be asked to quit\n' >&2
  exit 1
fi
printf 'Activating staged Comma shell %s\n' "$expected_sha"
