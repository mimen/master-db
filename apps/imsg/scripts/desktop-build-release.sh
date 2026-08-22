#!/usr/bin/env bash
# Builds immutable arm64 Comma shell bytes, or publishes a verified current pointer.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DESKTOP_DIR="$REPO_DIR/apps/imsg/desktop"
RELEASE_DIR="${COMMA_RELEASE_DIR:-$DESKTOP_DIR/releases}"
ARTIFACT_BASE_URL="${COMMA_ARTIFACT_BASE_URL:-https://milads-mac-mini.taild31e9a.ts.net:8447/api/desktop-release/artifact}"
EXPECTED_BUNDLE_ID="${COMMA_BUNDLE_ID:-com.milad.imsg.desktop}"
RETENTION="${COMMA_RELEASE_RETENTION:-3}"
TEMP_MAX_AGE_SECONDS="${COMMA_RELEASE_TEMP_MAX_AGE_SECONDS:-1800}"
MODE="${1:---build}"
SOURCE_SHA="${2:-$(git -C "$REPO_DIR" rev-parse HEAD)}"
BUNDLE="${3:-}"
TMP_RELEASE=""
CURRENT_TMP=""

fail() { printf 'desktop release: %s\n' "$*" >&2; exit 1; }
[[ "$MODE" = "--build" || "$MODE" = "--publish-current" ]] || fail "mode must be --build or --publish-current"
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "source SHA must be a full lowercase Git SHA"
[[ "$ARTIFACT_BASE_URL" == https://* ]] || fail "artifact base URL must use HTTPS"
[[ "$RETENTION" =~ ^[1-9][0-9]*$ ]] && [ "$RETENTION" -ge 2 ] || fail "release retention must be an integer of at least two"
[[ "$TEMP_MAX_AGE_SECONDS" =~ ^[1-9][0-9]*$ ]] || fail "temp max age must be a positive integer"
[ "$(uname -m)" = "arm64" ] || fail "production Comma releases must be built on arm64"

mkdir -p "$RELEASE_DIR"
ARTIFACT_NAME="Comma-${SOURCE_SHA}.app.zip"
RELEASE_PATH="$RELEASE_DIR/$SOURCE_SHA"
ARTIFACT_PATH="$RELEASE_PATH/$ARTIFACT_NAME"
RELEASE_MANIFEST="$RELEASE_PATH/manifest.json"
CURRENT_MANIFEST="$RELEASE_DIR/current.json"
ARTIFACT_URL="${ARTIFACT_BASE_URL%/}/$ARTIFACT_NAME"

cleanup() {
  [ -z "$TMP_RELEASE" ] || rm -rf "$TMP_RELEASE"
  [ -z "$CURRENT_TMP" ] || rm -f "$CURRENT_TMP"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

sweep_cancelled_publications() {
  local path base pid modified now age
  now="$(date +%s)"
  for path in "$RELEASE_DIR"/.*.tmp.*; do
    [ -e "$path" ] || continue
    base="${path##*/}"
    pid="${base##*.tmp.}"
    modified="$(stat -f %m "$path" 2>/dev/null || printf '0')"
    age=$((now - modified))
    if [[ "$pid" =~ ^[0-9]+$ ]]; then
      if ! kill -0 "$pid" 2>/dev/null; then
        rm -rf "$path"
      elif [ "$age" -gt "$TEMP_MAX_AGE_SECONDS" ] \
        && ! ps -p "$pid" -o args= | /usr/bin/grep -F 'comma:shell-builder' >/dev/null; then
        rm -rf "$path"
      fi
    elif [ "$age" -gt "$TEMP_MAX_AGE_SECONDS" ]; then
      rm -rf "$path"
    fi
  done
}

verify_published_release() {
  [ -f "$RELEASE_MANIFEST" ] && [ -f "$ARTIFACT_PATH" ] || return 1
  local published_sha published_checksum published_size published_built_at published_semver
  local published_bundle_id published_url actual_checksum actual_size
  published_sha="$(plutil -extract sourceSha raw -o - "$RELEASE_MANIFEST" 2>/dev/null || true)"
  published_checksum="$(plutil -extract sha256 raw -o - "$RELEASE_MANIFEST" 2>/dev/null || true)"
  published_size="$(plutil -extract size raw -o - "$RELEASE_MANIFEST" 2>/dev/null || true)"
  published_built_at="$(plutil -extract builtAt raw -o - "$RELEASE_MANIFEST" 2>/dev/null || true)"
  published_semver="$(plutil -extract semver raw -o - "$RELEASE_MANIFEST" 2>/dev/null || true)"
  published_bundle_id="$(plutil -extract bundleId raw -o - "$RELEASE_MANIFEST" 2>/dev/null || true)"
  published_url="$(plutil -extract artifactUrl raw -o - "$RELEASE_MANIFEST" 2>/dev/null || true)"
  actual_checksum="$(shasum -a 256 "$ARTIFACT_PATH" | cut -d ' ' -f 1)"
  actual_size="$(stat -f %z "$ARTIFACT_PATH")"
  [ "$published_sha" = "$SOURCE_SHA" ] \
    && [ "$published_checksum" = "$actual_checksum" ] \
    && [ "$published_size" = "$actual_size" ] \
    && [[ "$published_built_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
    && [[ "$published_semver" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$ ]] \
    && [ "$published_bundle_id" = "$EXPECTED_BUNDLE_ID" ] \
    && [ "$published_url" = "$ARTIFACT_URL" ]
}

prune_releases() {
  local prior_sha="${1:-}" path sha kept=0
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    sha="${path##*/}"
    [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || continue
    if [ "$sha" = "$SOURCE_SHA" ] || { [ -n "$prior_sha" ] && [ "$sha" = "$prior_sha" ]; }; then
      continue
    fi
    kept=$((kept + 1))
    if [ "$kept" -gt $((RETENTION - 2)) ]; then rm -rf "$path"; fi
  done < <(find "$RELEASE_DIR" -mindepth 1 -maxdepth 1 -type d -print0 | xargs -0 ls -1dt 2>/dev/null || true)
}

publish_current_pointer() {
  verify_published_release || fail "immutable release is incomplete or invalid: $RELEASE_PATH"
  local prior_sha=""
  if [ -f "$CURRENT_MANIFEST" ]; then
    prior_sha="$(plutil -extract sourceSha raw -o - "$CURRENT_MANIFEST" 2>/dev/null || true)"
  fi
  CURRENT_TMP="$RELEASE_DIR/.current.json.tmp.$$"
  cp "$RELEASE_MANIFEST" "$CURRENT_TMP"
  mv "$CURRENT_TMP" "$CURRENT_MANIFEST"
  CURRENT_TMP=""
  prune_releases "$prior_sha"
  printf 'Published current Comma shell release %s\n' "$SOURCE_SHA"
}

sweep_cancelled_publications

if [ "$MODE" = "--publish-current" ]; then
  publish_current_pointer
  exit 0
fi

if [ -e "$RELEASE_PATH" ]; then
  verify_published_release || fail "existing immutable release is incomplete or invalid: $RELEASE_PATH"
  printf 'Comma shell release already built: %s\n' "$SOURCE_SHA"
  exit 0
fi

printf 'Building immutable Comma shell release %s\n' "$SOURCE_SHA"
if [ -z "$BUNDLE" ]; then
  command -v cargo >/dev/null || fail "Rust cargo is required on the Mini shell builder"
  [ -x "$DESKTOP_DIR/node_modules/.bin/tauri" ] || fail "locked Tauri CLI is missing; install desktop dependencies first"
  (
    cd "$DESKTOP_DIR"
    COMMA_SOURCE_SHA="$SOURCE_SHA" "$DESKTOP_DIR/node_modules/.bin/tauri" build --bundles app
  )
  BUNDLE="$(find "$DESKTOP_DIR/src-tauri/target/release/bundle/macos" -maxdepth 1 -type d -name '*.app' -print -quit)"
fi
[ -n "$BUNDLE" ] && [ -d "$BUNDLE" ] || fail "Tauri did not produce a macOS app bundle"
INFO_PLIST="$BUNDLE/Contents/Info.plist"

/usr/libexec/PlistBuddy -c "Set :CommaSourceSHA $SOURCE_SHA" "$INFO_PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CommaSourceSHA string $SOURCE_SHA" "$INFO_PLIST"
BUNDLE_ID="$(plutil -extract CFBundleIdentifier raw -o - "$INFO_PLIST")"
SEMVER="$(plutil -extract CFBundleShortVersionString raw -o - "$INFO_PLIST")"
[ "$BUNDLE_ID" = "$EXPECTED_BUNDLE_ID" ] || fail "unexpected bundle ID: $BUNDLE_ID"
[[ "$SEMVER" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$ ]] || fail "bundle version is not semver: $SEMVER"

EXECUTABLE="$(plutil -extract CFBundleExecutable raw -o - "$INFO_PLIST")"
BINARY="$BUNDLE/Contents/MacOS/$EXECUTABLE"
ARCHS="$(lipo -archs "$BINARY")"
case " $ARCHS " in *" arm64 "*) ;; *) fail "bundle executable is not arm64: $ARCHS" ;; esac
/usr/bin/strings "$BINARY" | /usr/bin/grep -F "$SOURCE_SHA" >/dev/null \
  || fail "bundle executable does not embed source SHA $SOURCE_SHA"

codesign --force --deep --sign - "$BUNDLE"
codesign --verify --deep --strict "$BUNDLE"
codesign -dvv "$BUNDLE" 2>&1 | /usr/bin/grep -q '^Signature=adhoc$' || fail "bundle signature is not ad-hoc"

TMP_RELEASE="$RELEASE_DIR/.${SOURCE_SHA}.tmp.$$"
TMP_ARTIFACT="$TMP_RELEASE/$ARTIFACT_NAME"
TMP_MANIFEST="$TMP_RELEASE/manifest.json"
mkdir "$TMP_RELEASE"
ditto -c -k --keepParent "$BUNDLE" "$TMP_ARTIFACT"
SHA256="$(shasum -a 256 "$TMP_ARTIFACT" | cut -d ' ' -f 1)"
SIZE="$(stat -f %z "$TMP_ARTIFACT")"
BUILT_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

SOURCE_SHA="$SOURCE_SHA" SHA256="$SHA256" SIZE="$SIZE" BUILT_AT="$BUILT_AT" \
SEMVER="$SEMVER" BUNDLE_ID="$BUNDLE_ID" ARTIFACT_URL="$ARTIFACT_URL" \
TMP_MANIFEST="$TMP_MANIFEST" /bin/zsh -c '
  exec -a comma:manifest-writer bun -e '\''
    import { writeFileSync } from "node:fs";
    const manifest = {
      sourceSha: process.env.SOURCE_SHA,
      sha256: process.env.SHA256,
      size: Number(process.env.SIZE),
      builtAt: process.env.BUILT_AT,
      semver: process.env.SEMVER,
      bundleId: process.env.BUNDLE_ID,
      artifactUrl: process.env.ARTIFACT_URL,
    };
    writeFileSync(process.env.TMP_MANIFEST!, `${JSON.stringify(manifest, null, 2)}\n`);
  '\''
'

mv "$TMP_RELEASE" "$RELEASE_PATH"
TMP_RELEASE=""
printf 'Built %s (%s bytes, %s)\n' "$ARTIFACT_URL" "$SIZE" "$SHA256"
