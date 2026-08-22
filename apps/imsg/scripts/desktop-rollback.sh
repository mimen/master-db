#!/usr/bin/env bash
# Explicitly exchanges the canonical Comma app with its retained rollback copy.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=desktop-app-verify.sh
source "$SCRIPT_DIR/desktop-app-verify.sh"

APP="${COMMA_APP:-$HOME/Applications/Comma.app}"
PREVIOUS="${COMMA_PREVIOUS_APP:-${APP}.previous}"
LOCK="${COMMA_ACTIVATION_LOCK:-${APP}.activation.lock}"
OPEN_BIN="${COMMA_OPEN_BIN:-/usr/bin/open}"

[ -d "$APP" ] || { printf 'canonical Comma app is missing: %s\n' "$APP" >&2; exit 1; }
[ -d "$PREVIOUS" ] || { printf 'no retained Comma rollback is available\n' >&2; exit 1; }
previous_sha="$(comma_plist_value "$PREVIOUS" CommaSourceSHA)"
comma_verify_app "$PREVIOUS" "$previous_sha"
comma_acquire_lock "$LOCK" comma:rollback || { printf 'Comma activation is already running\n' >&2; exit 1; }
trap 'rm -rf "$LOCK"' EXIT

bundle_id="$(comma_plist_value "$APP" CFBundleIdentifier)"
/usr/bin/osascript -e "tell application id \"$bundle_id\" to quit" >/dev/null 2>&1 || true
binary="$APP/Contents/MacOS/$(comma_plist_value "$APP" CFBundleExecutable)"
for _ in $(seq 1 30); do
  /usr/bin/pgrep -f "^${binary//./\\.}( |$)" >/dev/null 2>&1 || break
  sleep 1
done
/usr/bin/pgrep -f "^${binary//./\\.}( |$)" >/dev/null 2>&1 \
  && { printf 'Comma did not exit; rollback cancelled\n' >&2; exit 1; }

/bin/zsh -c 'unset PROCID PROCID_REF PROCID_OFF; exec -a comma:bundle-swap /usr/bin/python3 "$@"' \
  comma:bundle-swap "$SCRIPT_DIR/desktop-swap-apps.py" "$APP" "$PREVIOUS"
if ! "$OPEN_BIN" -n "$APP"; then
  /bin/zsh -c 'unset PROCID PROCID_REF PROCID_OFF; exec -a comma:bundle-swap /usr/bin/python3 "$@"' \
    comma:bundle-swap "$SCRIPT_DIR/desktop-swap-apps.py" "$APP" "$PREVIOUS" || true
  "$OPEN_BIN" -n "$APP" || true
  printf 'rollback launch failed; restored the prior canonical app\n' >&2
  exit 1
fi
printf 'Rolled Comma back to %s\n' "$previous_sha"
