#!/usr/bin/env bash
# Detached helper: swap a verified staged Comma bundle only after Comma exits.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=desktop-app-verify.sh
source "$SCRIPT_DIR/desktop-app-verify.sh"

atomic_swap() {
  /bin/zsh -c 'unset PROCID PROCID_REF PROCID_OFF; exec -a comma:bundle-swap /usr/bin/python3 "$@"' \
    comma:bundle-swap "$SCRIPT_DIR/desktop-swap-apps.py" "$1" "$2"
}

APP="${COMMA_APP:-$HOME/Applications/Comma.app}"
STAGED="${COMMA_STAGED_APP:-${APP}.staged}"
PREVIOUS="${COMMA_PREVIOUS_APP:-${APP}.previous}"
EXPECTED_SHA=""
WAIT_PID=""
READY_FILE=""
WAIT_TIMEOUT="${COMMA_EXIT_TIMEOUT_SECONDS:-120}"
LAUNCH_TIMEOUT="${COMMA_LAUNCH_TIMEOUT_SECONDS:-30}"
HEALTH_STABILIZATION="${COMMA_HEALTH_STABILIZATION_SECONDS:-3}"
LOG="${COMMA_ACTIVATION_LOG:-$HOME/Library/Logs/comma-activation.log}"
STATE="${COMMA_ACTIVATION_STATE:-$HOME/Library/Application Support/Comma/activation.json}"
OPEN_BIN="${COMMA_OPEN_BIN:-/usr/bin/open}"
PROCESS_PROBE="${COMMA_PROCESS_PROBE:-}"
APP_EXITED=0
RUNNING_PID=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --app) APP="$2"; STAGED="${2}.staged"; PREVIOUS="${2}.previous"; shift 2 ;;
    --expected-sha) EXPECTED_SHA="$2"; shift 2 ;;
    --wait-pid) WAIT_PID="$2"; shift 2 ;;
    --ready-file) READY_FILE="$2"; shift 2 ;;
    *) printf 'unknown activation argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

mkdir -p "$(dirname "$LOG")" "$(dirname "$STATE")"
exec >>"$LOG" 2>&1
log() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }
write_state() {
  local status="$1" detail="$2"
  printf '{"status":"%s","sourceSha":"%s","detail":"%s","updatedAt":"%s"}\n' \
    "$status" "$EXPECTED_SHA" "$detail" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >"${STATE}.tmp"
  mv "${STATE}.tmp" "$STATE"
}
fail_before_swap() {
  log "$1"
  if [ "$APP_EXITED" -eq 1 ] && [ -d "$APP" ]; then "$OPEN_BIN" -n "$APP" || true; fi
  write_state failed "$1" || true
  exit 1
}

[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || fail_before_swap "invalid expected source SHA"
[ -n "$WAIT_PID" ] && [[ "$WAIT_PID" =~ ^[0-9]+$ ]] || fail_before_swap "invalid wait PID"
[ -n "$READY_FILE" ] || fail_before_swap "missing readiness file"
LOCK="${COMMA_ACTIVATION_LOCK:-${APP}.activation.lock}"
if ! comma_acquire_lock "$LOCK" comma:activator; then
  log "another Comma staging or activation process is already running"
  exit 1
fi
trap 'rm -rf "$LOCK"' EXIT

comma_verify_app "$STAGED" "$EXPECTED_SHA" || fail_before_swap "staged app verification failed"
[ -d "$APP" ] || fail_before_swap "canonical app is missing"
printf 'ready\n' >"$READY_FILE"

log "waiting for Comma PID $WAIT_PID to exit"
elapsed=0
while kill -0 "$WAIT_PID" 2>/dev/null; do
  if [ "$elapsed" -ge "$WAIT_TIMEOUT" ]; then
    fail_before_swap "Comma did not exit within ${WAIT_TIMEOUT}s"
  fi
  sleep 1
  elapsed=$((elapsed + 1))
done
APP_EXITED=1

# A prior rollback copy remains available between activations. The app being
# replaced is always the correct immediate rollback target for this activation.
rm -rf "$PREVIOUS" || fail_before_swap "failed to clear the prior rollback bundle"
if ! atomic_swap "$APP" "$STAGED"; then
  fail_before_swap "failed to atomically exchange staged and canonical apps"
fi
# After the exchange, canonical is always present and the old app occupies the
# staged path. Moving that rollback copy can be retried or reversed safely.
if ! mv "$STAGED" "$PREVIOUS"; then
  atomic_swap "$APP" "$STAGED" 2>/dev/null || true
  fail_before_swap "failed to retain the previous app after exchange"
fi
touch "$PREVIOUS" || log "warning: could not refresh rollback retention timestamp"

rollback() {
  local reason="$1"
  log "$reason; rolling back"
  if [ -n "$RUNNING_PID" ] && kill -0 "$RUNNING_PID" 2>/dev/null; then
    kill "$RUNNING_PID" 2>/dev/null || true
    for _ in $(seq 1 5); do
      kill -0 "$RUNNING_PID" 2>/dev/null || break
      sleep 1
    done
    if kill -0 "$RUNNING_PID" 2>/dev/null; then
      kill -9 "$RUNNING_PID" 2>/dev/null || true
      while kill -0 "$RUNNING_PID" 2>/dev/null; do sleep 1; done
    fi
  fi
  if ! atomic_swap "$APP" "$PREVIOUS"; then
    write_state rollback-failed "$reason"
    log "rollback exchange failed; canonical app remains at $APP"
    exit 1
  fi
  rm -rf "$PREVIOUS" # failed new bundle after the exchange
  "$OPEN_BIN" -n "$APP" || true
  write_state rolled-back "$reason"
  exit 1
}

comma_verify_app "$APP" "$EXPECTED_SHA" || rollback "activated app identity verification failed"
"$OPEN_BIN" -n "$APP" || rollback "launch command failed"
EXECUTABLE="$(comma_plist_value "$APP" CFBundleExecutable)"
BINARY="$APP/Contents/MacOS/$EXECUTABLE"

running_pids() {
  if [ -n "$PROCESS_PROBE" ]; then
    "$PROCESS_PROBE" "$BINARY"
    return
  fi
  local line pid command
  while IFS= read -r line; do
    if [[ "$line" =~ ^[[:space:]]*([0-9]+)[[:space:]]+(.*)$ ]]; then
      pid="${BASH_REMATCH[1]}"
      command="${BASH_REMATCH[2]}"
      case "$command" in
        "$BINARY"|"$BINARY "*) printf '%s\n' "$pid" ;;
      esac
    fi
  done < <(/bin/ps -axo pid=,command=)
}

RUNNING_PID=""
for _ in $(seq 1 "$LAUNCH_TIMEOUT"); do
  candidate="$(running_pids 2>/dev/null || true)"
  if [[ "$candidate" =~ ^[0-9]+$ ]]; then RUNNING_PID="$candidate"; break; fi
  sleep 1
done
[ -n "$RUNNING_PID" ] || rollback "exactly one new Comma process did not appear"
if [ "$HEALTH_STABILIZATION" -gt 0 ]; then sleep "$HEALTH_STABILIZATION"; fi
[ "$(running_pids 2>/dev/null || true)" = "$RUNNING_PID" ] \
  || rollback "new Comma process did not remain healthy"
comma_verify_app "$APP" "$EXPECTED_SHA" || rollback "running app identity changed after launch"
write_state activated "activation verified"
log "activated Comma shell $EXPECTED_SHA; previous retained at $PREVIOUS"
