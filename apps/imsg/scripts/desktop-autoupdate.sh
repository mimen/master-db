#!/usr/bin/env bash
# Laptop stager for immutable Mini-built Comma.app shell releases.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=desktop-app-verify.sh
source "$SCRIPT_DIR/desktop-app-verify.sh"

URL="${COMMA_RELEASE_URL:-https://milads-mac-mini.taild31e9a.ts.net:8447/api/desktop-release}"
APP="${COMMA_APP:-$HOME/Applications/Comma.app}"
STAGED="${COMMA_STAGED_APP:-${APP}.staged}"
PREVIOUS="${COMMA_PREVIOUS_APP:-${APP}.previous}"
EXPECTED_BUNDLE_ID="${COMMA_BUNDLE_ID:-com.milad.imsg.desktop}"
EXPECTED_ARCH="${COMMA_ARCH:-arm64}"
LOCK="${COMMA_STAGER_LOCK:-${TMPDIR:-/tmp}/comma-stager.lock}"
ACTIVATION_LOCK="${COMMA_ACTIVATION_LOCK:-${APP}.activation.lock}"
ACTIVATION_STATE="${COMMA_ACTIVATION_STATE:-$HOME/Library/Application Support/Comma/activation.json}"
LOG="${COMMA_STAGER_LOG:-$HOME/Library/Logs/comma-stager.log}"
STAGER_ID="comma:stager"

mkdir -p "$(dirname "$LOG")"
log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >>"$LOG"; }

comma_acquire_lock "$LOCK" "$STAGER_ID" || exit 0
if ! comma_acquire_lock "$ACTIVATION_LOCK" "$STAGER_ID"; then
  comma_release_lock "$LOCK" "$STAGER_ID"
  exit 0
fi
WORK_DIR=""
cleanup() {
  comma_release_lock "$ACTIVATION_LOCK" "$STAGER_ID"
  comma_release_lock "$LOCK" "$STAGER_ID"
  [ -z "$WORK_DIR" ] || rm -rf "$WORK_DIR"
}
trap cleanup EXIT

# The rollback copy survives seven full days unless a newer activation replaces it.
if [ -d "$PREVIOUS" ]; then
  previous_mtime="$(stat -f %m "$PREVIOUS" 2>/dev/null || true)"
  if [[ "$previous_mtime" =~ ^[0-9]+$ ]] && [ "$(( $(date +%s) - previous_mtime ))" -ge 604800 ]; then
    rm -rf "$PREVIOUS"
    log "removed expired rollback bundle $PREVIOUS"
  fi
fi

APP_PARENT="$(dirname "$APP")"
mkdir -p "$APP_PARENT"
WORK_DIR="$APP_PARENT/.comma-stage.$$"
mkdir "$WORK_DIR"
MANIFEST="$WORK_DIR/release.json"
ARCHIVE="$WORK_DIR/release.zip"
EXPANDED="$WORK_DIR/expanded"

curl -fsS --max-time 20 "$URL" -o "$MANIFEST" || { log "release manifest download failed"; exit 1; }
SOURCE_SHA="$(plutil -extract sourceSha raw -o - "$MANIFEST")"
SHA256="$(plutil -extract sha256 raw -o - "$MANIFEST")"
SIZE="$(plutil -extract size raw -o - "$MANIFEST")"
BUILT_AT="$(plutil -extract builtAt raw -o - "$MANIFEST")"
SEMVER="$(plutil -extract semver raw -o - "$MANIFEST")"
BUNDLE_ID="$(plutil -extract bundleId raw -o - "$MANIFEST")"
ARTIFACT_URL="$(plutil -extract artifactUrl raw -o - "$MANIFEST")"

[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || { log "manifest has invalid source SHA"; exit 1; }
[[ "$SHA256" =~ ^[0-9a-f]{64}$ ]] || { log "manifest has invalid checksum"; exit 1; }
[[ "$SIZE" =~ ^[1-9][0-9]*$ ]] || { log "manifest has invalid size"; exit 1; }
[[ "$BUILT_AT" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || { log "manifest has invalid build time"; exit 1; }
[[ "$SEMVER" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$ ]] || { log "manifest has non-semver version"; exit 1; }
[ "$BUNDLE_ID" = "$EXPECTED_BUNDLE_ID" ] || { log "manifest has unexpected bundle ID"; exit 1; }
ARTIFACT_PATH_PART="${ARTIFACT_URL%%\?*}"
[[ "$ARTIFACT_PATH_PART" == */"Comma-${SOURCE_SHA}.app.zip" ]] || { log "manifest artifact name does not match source SHA"; exit 1; }
if [ "${COMMA_ALLOW_INSECURE_URL:-0}" != "1" ] && [[ "$ARTIFACT_URL" != https://* ]]; then
  log "manifest artifact URL is not HTTPS"
  exit 1
fi

activation_status=""
activation_sha=""
activation_previous_sha=""
if [ -f "$ACTIVATION_STATE" ]; then
  activation_status="$(plutil -extract status raw -o - "$ACTIVATION_STATE" 2>/dev/null || true)"
  activation_sha="$(plutil -extract sourceSha raw -o - "$ACTIVATION_STATE" 2>/dev/null || true)"
  activation_previous_sha="$(plutil -extract previousSha raw -o - "$ACTIVATION_STATE" 2>/dev/null || true)"
fi

if [ "$activation_status" = "activating" ] && [ -d "$APP" ] && [ -d "$PREVIOUS" ]; then
  installed_sha="$(comma_plist_value "$APP" CommaSourceSHA 2>/dev/null || true)"
  failed_sha="$(comma_plist_value "$PREVIOUS" CommaSourceSHA 2>/dev/null || true)"
  if [ "$installed_sha" = "$activation_previous_sha" ] \
    && [ "$failed_sha" = "$activation_sha" ] \
    && comma_verify_app "$APP" "$activation_previous_sha" "$EXPECTED_BUNDLE_ID" "$EXPECTED_ARCH" \
    && comma_verify_app "$PREVIOUS" "$activation_sha" "$EXPECTED_BUNDLE_ID" "$EXPECTED_ARCH"; then
    rm -rf "$PREVIOUS"
    printf '{"status":"rolled-back","sourceSha":"%s","previousSha":"%s","detail":"%s","updatedAt":"%s"}\n' \
      "$activation_sha" "$activation_previous_sha" "recovered interrupted automatic rollback" \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >"${ACTIVATION_STATE}.tmp"
    mv "${ACTIVATION_STATE}.tmp" "$ACTIVATION_STATE"
    activation_status="rolled-back"
    log "recovered interrupted automatic rollback of $activation_sha"
    comma_notify "Comma update rolled back" "Recovered the previous Comma shell after an interrupted rollback"
  fi
fi

case "$activation_status" in
  failed|rolled-back|rollback-failed)
    if [ "$activation_sha" = "$SOURCE_SHA" ]; then
      if [ -d "$STAGED" ] \
        && [ "$(comma_plist_value "$STAGED" CommaSourceSHA 2>/dev/null || true)" = "$SOURCE_SHA" ]; then
        rm -rf "$STAGED"
      fi
      log "refusing rejected Comma shell $SOURCE_SHA until the Mini current release advances"
      exit 0
    fi
    ;;
esac

if [ "$activation_status" = "activating" ] && [ -d "$APP" ] && [ -d "$STAGED" ]; then
  installed_sha="$(comma_plist_value "$APP" CommaSourceSHA 2>/dev/null || true)"
  interrupted_sha="$(comma_plist_value "$STAGED" CommaSourceSHA 2>/dev/null || true)"
  if [ "$installed_sha" = "$activation_sha" ] \
    && [[ "$activation_previous_sha" =~ ^[0-9a-f]{40}$ ]] \
    && [ "$interrupted_sha" = "$activation_previous_sha" ] \
    && [ "$interrupted_sha" != "$installed_sha" ] \
    && comma_verify_app "$APP" "$installed_sha" "$EXPECTED_BUNDLE_ID" "$EXPECTED_ARCH" \
    && comma_verify_app "$STAGED" "$interrupted_sha" "$EXPECTED_BUNDLE_ID" "$EXPECTED_ARCH"; then
    rm -rf "$PREVIOUS"
    mv "$STAGED" "$PREVIOUS"
    touch "$PREVIOUS"
    log "recovered prior app from an interrupted post-swap activation"
  fi
fi

if [ -d "$APP" ]; then
  installed_sha="$(comma_plist_value "$APP" CommaSourceSHA 2>/dev/null || true)"
  installed_semver="$(comma_plist_value "$APP" CFBundleShortVersionString 2>/dev/null || true)"
  if [ "$installed_sha" = "$SOURCE_SHA" ] && [ "$installed_semver" = "$SEMVER" ] \
    && comma_verify_app "$APP" "$SOURCE_SHA" "$EXPECTED_BUNDLE_ID" "$EXPECTED_ARCH"; then
    if [ -d "$STAGED" ]; then
      interrupted_sha="$(comma_plist_value "$STAGED" CommaSourceSHA 2>/dev/null || true)"
      if [[ "$interrupted_sha" =~ ^[0-9a-f]{40}$ ]] \
        && [ "$interrupted_sha" != "$SOURCE_SHA" ] \
        && comma_verify_app "$STAGED" "$interrupted_sha" "$EXPECTED_BUNDLE_ID" "$EXPECTED_ARCH"; then
        rm -rf "$PREVIOUS"
        mv "$STAGED" "$PREVIOUS"
        touch "$PREVIOUS"
        log "recovered prior app from an interrupted post-swap activation"
      else
        rm -rf "$STAGED"
      fi
    fi
    exit 0
  fi
fi

if [ -d "$STAGED" ]; then
  staged_sha="$(comma_plist_value "$STAGED" CommaSourceSHA 2>/dev/null || true)"
  staged_semver="$(comma_plist_value "$STAGED" CFBundleShortVersionString 2>/dev/null || true)"
  if [ "$staged_sha" = "$SOURCE_SHA" ] && [ "$staged_semver" = "$SEMVER" ] \
    && comma_verify_app "$STAGED" "$SOURCE_SHA" "$EXPECTED_BUNDLE_ID" "$EXPECTED_ARCH"; then
    exit 0
  fi
fi

log "staging Comma shell $SOURCE_SHA ($SEMVER)"
curl -fsS --max-time 300 "$ARTIFACT_URL" -o "$ARCHIVE" || { log "artifact download failed"; exit 1; }
ACTUAL_SIZE="$(stat -f %z "$ARCHIVE")"
[ "$ACTUAL_SIZE" = "$SIZE" ] || { log "artifact size mismatch: expected $SIZE, got $ACTUAL_SIZE"; exit 1; }
ACTUAL_SHA256="$(shasum -a 256 "$ARCHIVE" | cut -d ' ' -f 1)"
[ "$ACTUAL_SHA256" = "$SHA256" ] || { log "artifact checksum mismatch"; exit 1; }

mkdir "$EXPANDED"
ditto -x -k "$ARCHIVE" "$EXPANDED"
BUNDLE="$(find "$EXPANDED" -maxdepth 1 -type d -name '*.app' -print -quit)"
[ -n "$BUNDLE" ] || { log "artifact contains no app bundle"; exit 1; }
[ "$(find "$EXPANDED" -maxdepth 1 -type d -name '*.app' | wc -l | tr -d ' ')" = "1" ] \
  || { log "artifact contains multiple app bundles"; exit 1; }
xattr -cr "$BUNDLE" 2>/dev/null || true
comma_verify_app "$BUNDLE" "$SOURCE_SHA" "$EXPECTED_BUNDLE_ID" "$EXPECTED_ARCH" \
  || { log "downloaded app verification failed"; exit 1; }
BUNDLE_SEMVER="$(comma_plist_value "$BUNDLE" CFBundleShortVersionString)"
[ "$BUNDLE_SEMVER" = "$SEMVER" ] || { log "bundle semver does not match manifest"; exit 1; }

STAGE_TMP="${STAGED}.tmp.$$"
rm -rf "$STAGE_TMP"
mv "$BUNDLE" "$STAGE_TMP"
rm -rf "$STAGED"
mv "$STAGE_TMP" "$STAGED"
log "staged Comma shell $SOURCE_SHA at $STAGED; running app was not touched"
