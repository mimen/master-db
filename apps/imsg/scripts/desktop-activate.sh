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
LOCK_WAIT_TIMEOUT="${COMMA_ACTIVATION_LOCK_TIMEOUT_SECONDS:-15}"
LOG="${COMMA_ACTIVATION_LOG:-$HOME/Library/Logs/comma-activation.log}"
STATE="${COMMA_ACTIVATION_STATE:-$HOME/Library/Application Support/Comma/activation.json}"
OPEN_BIN="${COMMA_OPEN_BIN:-/usr/bin/open}"
PROCESS_PROBE="${COMMA_PROCESS_PROBE:-}"
APP_EXITED=0
RUNNING_PID=""
BINARY=""
PREVIOUS_SHA=""

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
  printf '{"status":"%s","sourceSha":"%s","previousSha":"%s","detail":"%s","updatedAt":"%s"}\n' \
    "$status" "$EXPECTED_SHA" "$PREVIOUS_SHA" "$detail" \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >"${STATE}.tmp"
  mv "${STATE}.tmp" "$STATE"
}
recover_exited_canonical() {
  local canonical_sha canonical_binary canonical_pid
  [ "$APP_EXITED" -eq 1 ] || return 0
  canonical_sha="$(comma_plist_value "$APP" CommaSourceSHA 2>/dev/null || true)"
  [[ "$canonical_sha" =~ ^[0-9a-f]{40}$ ]] || return 1
  comma_verify_app "$APP" "$canonical_sha" || return 1
  "$OPEN_BIN" -n "$APP" || return 1
  canonical_binary="$APP/Contents/MacOS/$(comma_plist_value "$APP" CFBundleExecutable)"
  canonical_pid="$(comma_wait_for_exact_process "$canonical_binary" "$LAUNCH_TIMEOUT" || true)"
  [ -n "$canonical_pid" ] || return 1
  comma_process_stable "$canonical_binary" "$canonical_pid" "$HEALTH_STABILIZATION" || return 1
  comma_verify_app "$APP" "$canonical_sha"
}
fail_before_swap() {
  log "$1"
  if ! recover_exited_canonical; then
    write_state rollback-failed "$1; canonical app did not recover" || true
    comma_notify "Comma recovery failed" "$1; the prior app did not restart"
    exit 1
  fi
  write_state failed "$1" || true
  comma_notify "Comma update failed" "$1"
  exit 1
}
fail_transient() {
  log "$1"
  if ! recover_exited_canonical; then
    write_state rollback-failed "$1; canonical app did not recover" || true
    comma_notify "Comma recovery failed" "$1; the prior app did not restart"
    exit 1
  fi
  write_state blocked "$1" || true
  comma_notify "Comma update could not start" "$1"
  exit 1
}

[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || fail_before_swap "invalid expected source SHA"
[ -n "$WAIT_PID" ] && [[ "$WAIT_PID" =~ ^[0-9]+$ ]] || fail_before_swap "invalid wait PID"
[ -n "$READY_FILE" ] || fail_before_swap "missing readiness file"
[[ "$LOCK_WAIT_TIMEOUT" =~ ^[0-9]+$ ]] && [ "$LOCK_WAIT_TIMEOUT" -le 60 ] \
  || fail_transient "activation lock wait must be between 0 and 60 seconds"
LOCK="${COMMA_ACTIVATION_LOCK:-${APP}.activation.lock}"
ACTIVATOR_ID="comma:activator"
if ! comma_acquire_lock_wait "$LOCK" "$ACTIVATOR_ID" "$LOCK_WAIT_TIMEOUT"; then
  fail_transient "activation lock did not become available within ${LOCK_WAIT_TIMEOUT}s"
fi
trap 'comma_release_lock "$LOCK" "$ACTIVATOR_ID"' EXIT

comma_verify_app "$STAGED" "$EXPECTED_SHA" || fail_before_swap "staged app verification failed"
[ -d "$APP" ] || fail_transient "canonical app is missing"
PREVIOUS_SHA="$(comma_plist_value "$APP" CommaSourceSHA 2>/dev/null || true)"
[[ "$PREVIOUS_SHA" =~ ^[0-9a-f]{40}$ ]] || fail_transient "canonical app has an invalid source SHA"
comma_verify_app "$APP" "$PREVIOUS_SHA" || fail_transient "canonical app is not a valid rollback target"
printf 'ready\n' >"$READY_FILE"

log "waiting for Comma PID $WAIT_PID to exit"
elapsed=0
while kill -0 "$WAIT_PID" 2>/dev/null; do
  if [ "$elapsed" -ge "$WAIT_TIMEOUT" ]; then
    fail_transient "Comma did not exit within ${WAIT_TIMEOUT}s"
  fi
  sleep 1
  elapsed=$((elapsed + 1))
done
APP_EXITED=1

# A prior rollback copy remains available between activations. The app being
# replaced is always the correct immediate rollback target for this activation.
rm -rf "$PREVIOUS" || fail_transient "failed to clear the prior rollback bundle"
write_state activating "app exited; bundle exchange starting" || fail_transient "failed to record activation intent"
if ! atomic_swap "$APP" "$STAGED"; then
  fail_transient "failed to atomically exchange staged and canonical apps"
fi
# After the exchange, canonical is always present and the old app occupies the
# staged path. Moving that rollback copy can be retried or reversed safely.
if ! mv "$STAGED" "$PREVIOUS"; then
  if atomic_swap "$APP" "$STAGED" 2>/dev/null; then
    fail_transient "failed to retain the previous app after exchange"
  fi
  write_state rollback-failed "failed to retain the previous app and compensating exchange failed" || true
  comma_notify "Comma rollback failed" "The previous app could not be restored after the bundle exchange"
  exit 1
fi
touch "$PREVIOUS" || log "warning: could not refresh rollback retention timestamp"

rollback() {
  local reason="$1" restored_sha restored_binary restored_pid restore_failure=""
  log "$reason; rolling back"
  restored_sha="$(comma_plist_value "$PREVIOUS" CommaSourceSHA 2>/dev/null || true)"
  if [ -n "$BINARY" ] && ! comma_stop_processes "$BINARY" 5; then
    write_state rollback-failed "$reason; failed shell processes could not be stopped"
    comma_notify "Comma rollback failed" "Failed shell processes could not be stopped safely"
    exit 1
  fi
  if ! atomic_swap "$APP" "$PREVIOUS"; then
    write_state rollback-failed "$reason"
    log "rollback exchange failed; canonical app remains at $APP"
    comma_notify "Comma rollback failed" "$reason"
    exit 1
  fi
  comma_verify_app "$APP" "$restored_sha" || restore_failure="restored app identity verification failed"
  if [ -z "$restore_failure" ] && ! "$OPEN_BIN" -n "$APP"; then
    restore_failure="restored app launch command failed"
  fi
  if [ -z "$restore_failure" ]; then
    restored_binary="$APP/Contents/MacOS/$(comma_plist_value "$APP" CFBundleExecutable)"
    restored_pid="$(comma_wait_for_exact_process "$restored_binary" "$LAUNCH_TIMEOUT" || true)"
    [ -n "$restored_pid" ] || restore_failure="exactly one restored Comma process did not appear"
  fi
  if [ -z "$restore_failure" ] \
    && ! comma_process_stable "$restored_binary" "$restored_pid" "$HEALTH_STABILIZATION"; then
    restore_failure="restored Comma process did not remain healthy"
  fi
  if [ -z "$restore_failure" ] && ! comma_verify_app "$APP" "$restored_sha"; then
    restore_failure="restored app identity changed after launch"
  fi
  if [ -n "$restore_failure" ]; then
    write_state rollback-failed "$reason; $restore_failure"
    comma_notify "Comma rollback failed" "$restore_failure"
    exit 1
  fi
  rm -rf "$PREVIOUS" # failed new bundle after the verified exchange
  write_state rolled-back "$reason"
  comma_notify "Comma update rolled back" "$reason"
  exit 1
}

comma_verify_app "$APP" "$EXPECTED_SHA" || rollback "activated app identity verification failed"
EXECUTABLE="$(comma_plist_value "$APP" CFBundleExecutable)"
BINARY="$APP/Contents/MacOS/$EXECUTABLE"
"$OPEN_BIN" -n "$APP" || rollback "launch command failed"

RUNNING_PID="$(comma_wait_for_exact_process "$BINARY" "$LAUNCH_TIMEOUT" || true)"
[ -n "$RUNNING_PID" ] || rollback "exactly one new Comma process did not appear"
comma_process_stable "$BINARY" "$RUNNING_PID" "$HEALTH_STABILIZATION" \
  || rollback "new Comma process did not remain healthy"
comma_verify_app "$APP" "$EXPECTED_SHA" || rollback "running app identity changed after launch"
write_state activated "activation verified"
log "activated Comma shell $EXPECTED_SHA; previous retained at $PREVIOUS"
