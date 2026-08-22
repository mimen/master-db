#!/usr/bin/env bash
# Builds and publishes one immutable arm64 Comma shell release on the Mini.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DESKTOP_DIR="$REPO_DIR/apps/imsg/desktop"
RELEASE_DIR="${COMMA_RELEASE_DIR:-$DESKTOP_DIR/releases}"
ARTIFACT_BASE_URL="${COMMA_ARTIFACT_BASE_URL:-https://milads-mac-mini.taild31e9a.ts.net:8447/api/desktop-release/artifact}"
EXPECTED_BUNDLE_ID="${COMMA_BUNDLE_ID:-com.milad.imsg.desktop}"
SOURCE_SHA="${1:-$(git -C "$REPO_DIR" rev-parse HEAD)}"
BUNDLE="${2:-}"

fail() { printf 'desktop release: %s\n' "$*" >&2; exit 1; }
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "source SHA must be a full lowercase Git SHA"
[[ "$ARTIFACT_BASE_URL" == https://* ]] || fail "artifact base URL must use HTTPS"
[ "$(uname -m)" = "arm64" ] || fail "production Comma releases must be built on arm64"

mkdir -p "$RELEASE_DIR"
ARTIFACT_NAME="Comma-${SOURCE_SHA}.app.zip"
RELEASE_PATH="$RELEASE_DIR/$SOURCE_SHA"
ARTIFACT_PATH="$RELEASE_PATH/$ARTIFACT_NAME"
RELEASE_MANIFEST="$RELEASE_PATH/manifest.json"
CURRENT_MANIFEST="$RELEASE_DIR/current.json"
ARTIFACT_URL="${ARTIFACT_BASE_URL%/}/$ARTIFACT_NAME"

publish_current_pointer() {
  local manifest="$1" temporary="$RELEASE_DIR/.current.json.tmp.$$"
  cp "$manifest" "$temporary"
  mv "$temporary" "$CURRENT_MANIFEST"
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

# The SHA directory is the immutable publication unit. Repointing current.json
# to a previously published release supports deterministic rollback without
# replacing the artifact bytes at their existing URL.
if [ -e "$RELEASE_PATH" ]; then
  verify_published_release || fail "existing immutable release is incomplete or invalid: $RELEASE_PATH"
  publish_current_pointer "$RELEASE_MANIFEST"
  printf 'Comma shell release already published: %s\n' "$SOURCE_SHA"
  exit 0
fi

printf 'Building Comma shell release %s\n' "$SOURCE_SHA"
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
trap 'rm -rf "$TMP_RELEASE" "$RELEASE_DIR/.current.json.tmp.$$"' EXIT
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

# One atomic directory rename publishes artifact plus manifest together; the
# current pointer moves only after that immutable unit is complete.
mv "$TMP_RELEASE" "$RELEASE_PATH"
publish_current_pointer "$RELEASE_MANIFEST"
trap - EXIT
printf 'Published %s (%s bytes, %s)\n' "$ARTIFACT_URL" "$SIZE" "$SHA256"
