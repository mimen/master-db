#!/usr/bin/env bash
# Explicitly exchanges the canonical Comma app with its retained rollback copy.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=desktop-app-verify.sh
source "$SCRIPT_DIR/desktop-app-verify.sh"

APP="${COMMA_APP:-$HOME/Applications/Comma.app}"
PREVIOUS="${COMMA_PREVIOUS_APP:-${APP}.previous}"
LOCK="${COMMA_ACTIVATION_LOCK:-${APP}.activation.lock}"
STATE="${COMMA_ACTIVATION_STATE:-$HOME/Library/Application Support/Comma/activation.json}"
OPEN_BIN="${COMMA_OPEN_BIN:-/usr/bin/open}"
OSASCRIPT_BIN="${COMMA_OSASCRIPT_BIN:-/usr/bin/osascript}"
QUIT_TIMEOUT="${COMMA_EXIT_TIMEOUT_SECONDS:-30}"
LAUNCH_TIMEOUT="${COMMA_LAUNCH_TIMEOUT_SECONDS:-30}"
HEALTH_STABILIZATION="${COMMA_HEALTH_STABILIZATION_SECONDS:-3}"
ROLLBACK_ID="comma:rollback"
RUNNING_PID=""
SWAPPED=0

atomic_swap() {
  /bin/zsh -c 'unset PROCID PROCID_REF PROCID_OFF; exec -a comma:bundle-swap /usr/bin/python3 "$@"' \
    comma:bundle-swap "$SCRIPT_DIR/desktop-swap-apps.py" "$1" "$2"
}

write_state() {
  local status="$1" source_sha="$2" detail="$3"
  mkdir -p "$(dirname "$STATE")"
  printf '{"status":"%s","sourceSha":"%s","detail":"%s","updatedAt":"%s"}\n' \
    "$status" "$source_sha" "$detail" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >"${STATE}.tmp"
  mv "${STATE}.tmp" "$STATE"
}

restore_canonical() {
  local rejected_sha="$1" reason="$2" failed_binary restored_binary restored_pid="" restore_failure=""
  failed_binary="$APP/Contents/MacOS/$(comma_plist_value "$APP" CFBundleExecutable)"
  comma_stop_processes "$failed_binary" 5 \
    || restore_failure="failed rollback process could not be stopped"
  if [ -z "$restore_failure" ] && [ "$SWAPPED" -eq 1 ] \
    && ! atomic_swap "$APP" "$PREVIOUS"; then
    restore_failure="restoring the prior canonical app exchange failed"
  fi
  if [ -z "$restore_failure" ] && ! comma_verify_app "$APP" "$rejected_sha"; then
    restore_failure="restored canonical app identity verification failed"
  fi
  if [ -z "$restore_failure" ] && ! "$OPEN_BIN" -n "$APP"; then
    restore_failure="restored canonical app launch command failed"
  fi
  if [ -z "$restore_failure" ]; then
    restored_binary="$APP/Contents/MacOS/$(comma_plist_value "$APP" CFBundleExecutable)"
    restored_pid="$(comma_wait_for_exact_process "$restored_binary" "$LAUNCH_TIMEOUT" || true)"
    [ -n "$restored_pid" ] || restore_failure="exactly one restored canonical Comma process did not appear"
  fi
  if [ -z "$restore_failure" ] \
    && ! comma_process_stable "$restored_binary" "$restored_pid" "$HEALTH_STABILIZATION"; then
    restore_failure="restored canonical Comma process did not remain healthy"
  fi
  if [ -z "$restore_failure" ] && ! comma_verify_app "$APP" "$rejected_sha"; then
    restore_failure="restored canonical app identity changed after launch"
  fi
  if [ -n "$restore_failure" ]; then
    write_state rollback-failed "$rejected_sha" "$reason; $restore_failure" || true
    comma_notify "Comma rollback failed" "$restore_failure"
    return 1
  fi
  write_state rollback-failed "$rejected_sha" "$reason; restored the prior canonical app" || true
  comma_notify "Comma rollback failed" "$reason; the prior Comma app was restored"
}

[ -d "$APP" ] || { printf 'canonical Comma app is missing: %s\n' "$APP" >&2; exit 1; }
[ -d "$PREVIOUS" ] || { printf 'no retained Comma rollback is available\n' >&2; exit 1; }
comma_acquire_lock "$LOCK" "$ROLLBACK_ID" || { printf 'Comma activation is already running\n' >&2; exit 1; }
trap 'comma_release_lock "$LOCK" "$ROLLBACK_ID"' EXIT
rejected_sha="$(comma_plist_value "$APP" CommaSourceSHA)"
previous_sha="$(comma_plist_value "$PREVIOUS" CommaSourceSHA)"
comma_verify_app "$APP" "$rejected_sha"
comma_verify_app "$PREVIOUS" "$previous_sha"

bundle_id="$(comma_plist_value "$APP" CFBundleIdentifier)"
"$OSASCRIPT_BIN" -e "tell application id \"$bundle_id\" to quit" >/dev/null 2>&1 || true
binary="$APP/Contents/MacOS/$(comma_plist_value "$APP" CFBundleExecutable)"
comma_wait_for_no_process "$binary" "$QUIT_TIMEOUT" \
  || { printf 'Comma did not exit; rollback cancelled\n' >&2; exit 1; }

if ! atomic_swap "$APP" "$PREVIOUS"; then
  if restore_canonical "$rejected_sha" "manual rollback exchange failed"; then
    printf 'manual rollback exchange failed; restarted the unchanged canonical app\n' >&2
  else
    printf 'manual rollback exchange failed; the unchanged canonical app did not recover\n' >&2
  fi
  exit 1
fi
SWAPPED=1

failure=""
comma_verify_app "$APP" "$previous_sha" || failure="rolled-back app identity verification failed"
if [ -z "$failure" ] && ! "$OPEN_BIN" -n "$APP"; then
  failure="rollback launch command failed"
fi
if [ -z "$failure" ]; then
  binary="$APP/Contents/MacOS/$(comma_plist_value "$APP" CFBundleExecutable)"
  RUNNING_PID="$(comma_wait_for_exact_process "$binary" "$LAUNCH_TIMEOUT" || true)"
  [ -n "$RUNNING_PID" ] || failure="exactly one rolled-back Comma process did not appear"
fi
if [ -z "$failure" ] \
  && ! comma_process_stable "$binary" "$RUNNING_PID" "$HEALTH_STABILIZATION"; then
  failure="rolled-back Comma process did not remain healthy"
fi
if [ -z "$failure" ] && ! comma_verify_app "$APP" "$previous_sha"; then
  failure="rolled-back app identity changed after launch"
fi

if [ -n "$failure" ]; then
  if restore_canonical "$rejected_sha" "$failure"; then
    printf '%s; restored the prior canonical app\n' "$failure" >&2
  else
    printf '%s; restoring the prior canonical app failed\n' "$failure" >&2
  fi
  exit 1
fi

write_state rolled-back "$rejected_sha" "manual rollback activated $previous_sha"
comma_notify "Comma rolled back" "Restored shell ${previous_sha:0:12}; rejected ${rejected_sha:0:12}"
printf 'Rolled Comma back to %s\n' "$previous_sha"
