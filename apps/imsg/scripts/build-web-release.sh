#!/usr/bin/env bash
# Builds a complete production web release in a sibling staging directory.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$(cd "$SCRIPT_DIR/../client" && pwd)"
SOURCE_SHA="${1:-}"
STAGING_DIR="${2:-$CLIENT_DIR/.dist-staging-${SOURCE_SHA}.$$}"

fail() { printf 'web release build: %s\n' "$*" >&2; exit 1; }
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "source SHA must be a full lowercase Git SHA"
case "$STAGING_DIR" in "$CLIENT_DIR"/.dist-staging-*) ;; *) fail "staging directory must be a client sibling named .dist-staging-*" ;; esac
[ ! -e "$STAGING_DIR" ] || fail "staging directory already exists: $STAGING_DIR"

BUILD_LOG="$(mktemp)"
BUILD_PID=""
cleanup() {
  local status=$?
  if [ -n "$BUILD_PID" ] && kill -0 "$BUILD_PID" 2>/dev/null; then
    kill "$BUILD_PID" 2>/dev/null || true
  fi
  rm -f "$BUILD_LOG"
  if [ "$status" -ne 0 ]; then rm -rf "$STAGING_DIR"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cd "$CLIENT_DIR"
bun scripts/validate-public-env.ts
EXPO_PUBLIC_IMSG_RELEASE_ENVIRONMENT=production \
EXPO_PUBLIC_IMSG_RELEASE_BRANCH= \
EXPO_PUBLIC_IMSG_WEB_SHA="$SOURCE_SHA" \
  bun x expo export --platform web --clear --output-dir "$STAGING_DIR" >"$BUILD_LOG" 2>&1 &
BUILD_PID=$!

DONE=0
for _ in $(seq 1 72); do
  if ! kill -0 "$BUILD_PID" 2>/dev/null; then
    wait "$BUILD_PID" || { cat "$BUILD_LOG"; fail "Expo export failed"; }
    BUILD_PID=""
    DONE=1
    break
  fi
  if [ -f "$STAGING_DIR/index.html" ] && compgen -G "$STAGING_DIR/_expo/static/js/web/*.js" >/dev/null; then
    DONE=1
    break
  fi
  sleep 5
done

sleep 2
if [ -n "$BUILD_PID" ] && kill -0 "$BUILD_PID" 2>/dev/null; then
  printf 'Expo export completed its files; stopping the hung exporter\n'
  kill "$BUILD_PID" 2>/dev/null || true
  wait "$BUILD_PID" 2>/dev/null || true
  BUILD_PID=""
fi
[ "$DONE" -eq 1 ] || { cat "$BUILD_LOG"; fail "Expo export did not finish in time"; }

EXPO_PUBLIC_IMSG_WEB_SHA="$SOURCE_SHA" bun scripts/post-export.ts "$STAGING_DIR"
(
  cd "$STAGING_DIR"
  find _expo/static -type f -print | LC_ALL=C sort > .comma-assets
)
[ -s "$STAGING_DIR/.comma-assets" ] || fail "release contains no static entry assets"
[ -f "$STAGING_DIR/index.html" ] || fail "release contains no index.html"
/usr/bin/grep -F "<meta name=\"comma-web-sha\" content=\"$SOURCE_SHA\"/>" "$STAGING_DIR/index.html" >/dev/null \
  || fail "release index does not embed source SHA"
ENTRY_ASSET="$(find "$STAGING_DIR/_expo/static/js/web" -type f -name '*.js' -print -quit)"
[ -n "$ENTRY_ASSET" ] || fail "release contains no JavaScript entry asset"
/usr/bin/grep -F "$SOURCE_SHA" "$ENTRY_ASSET" >/dev/null \
  || fail "release entry asset does not embed source SHA"
printf 'Built staged web release %s at %s\n' "$SOURCE_SHA" "$STAGING_DIR"
