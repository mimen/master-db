#!/usr/bin/env bash
# Laptop watcher for Comma.app shell updates.
#
# Polls the Mini's /api/desktop-version. When the deployed marker differs from
# the last-built one, this script: pulls main into a scratch checkout (never
# the primary), builds the Tauri shell there, and atomically swaps
# ~/Applications/Comma.app. Runs from the LaunchAgent
# com.milad.comma-autoupdate; safe to run concurrently with itself via a lock.
set -euo pipefail

URL="${COMMA_AUTOUPDATE_URL:-https://milads-mac-mini.taild31e9a.ts.net:8447/api/desktop-version}"
APP="${COMMA_APP:-$HOME/Applications/Comma.app}"
CHECKOUT="${COMMA_CHECKOUT:-$HOME/.cache/comma-autoupdate}"
MARKER="$HOME/Library/Logs/comma-autoupdate.version"
LOCK="/tmp/comma-autoupdate.lock"
LOG="$HOME/Library/Logs/comma-autoupdate.log"

if ! mkdir "$LOCK" 2>/dev/null; then
  # Stale-lock guard: if the lock is older than an hour, a previous run died
  # mid-build and the lock was never cleaned up.
  if [ -n "$(find "$LOCK" -maxdepth 0 -mtime +1h 2>/dev/null)" ]; then
    rmdir "$LOCK" 2>/dev/null || exit 0
  else
    exit 0 # another instance is already running
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

log() { echo "$(date '+%F %T') $*" >>"$LOG"; }

version="$(curl -sf --max-time 15 "$URL" | sed -E 's/.*"version":"([^"]*)".*/\1/')"
if [ -z "${version:-}" ] || [ "$version" = "null" ]; then
  exit 0 # no shell update pending on the Mini
fi

last=""
[ -f "$MARKER" ] && last="$(cat "$MARKER")"
if [ "$version" = "$last" ]; then
  exit 0 # already built this version
fi

log "new desktop shell version: $version (was ${last:-none}); building"

mkdir -p "$(dirname "$CHECKOUT")"
if [ ! -d "$CHECKOUT/.git" ]; then
  log "cloning into scratch checkout"
  git clone --filter=blob:none git@github.com:mimen/master-db.git "$CHECKOUT" >>"$LOG" 2>&1 \
    || { log "clone failed"; exit 1; }
fi

cd "$CHECKOUT"
git fetch origin main >>"$LOG" 2>&1 || { log "fetch failed"; exit 1; }
git checkout -q main
git reset -q --hard "origin/main"
git pull -q --ff-only origin main >>"$LOG" 2>&1 || { log "pull failed"; exit 1; }

BUILT_SHA="$(git rev-parse --short HEAD)"
if [ "$BUILT_SHA" != "$version" ]; then
  log "warning: building HEAD ($BUILT_SHA) but Mini reports $version — proceeding"
fi

cd apps/imsg/desktop
bun install >>"$LOG" 2>&1
bunx tauri build >>"$LOG" 2>&1 || { log "tauri build failed"; exit 1; }

BUNDLE="$(ls -d src-tauri/target/release/bundle/macos/*.app | head -1)"
if [ -z "$BUNDLE" ]; then
  log "no built .app found"; exit 1
fi

osascript -e 'tell application id "com.milad.imsg.desktop" to quit' >/dev/null 2>&1 || true
sleep 1
rm -rf "$APP.old"
[ -d "$APP" ] && mv "$APP" "$APP.old"
mv "$BUNDLE" "$APP" || { log "swap failed"; [ -d "$APP.old" ] && mv "$APP.old" "$APP"; exit 1; }
rm -rf "$APP.old"

echo "$version" > "$MARKER"
log "Comma.app updated to $version"
