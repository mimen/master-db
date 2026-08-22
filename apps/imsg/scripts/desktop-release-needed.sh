#!/usr/bin/env bash
# Exit 0 when desktop release inputs changed since the last successful deploy.
set -euo pipefail

REPO_DIR="${1:?repository path required}"
LAST_DEPLOYED_SHA="${2:-}"
CURRENT_SHA="${3:?current SHA required}"

if ! git -C "$REPO_DIR" cat-file -e "${CURRENT_SHA}^{commit}" 2>/dev/null; then
  printf 'current deploy SHA is not a commit: %s\n' "$CURRENT_SHA" >&2
  exit 2
fi

# Missing, corrupt, or pruned publication state must fail safe by producing a
# fresh shell even when the Git diff itself is server-only.
RELEASE_DIR="${COMMA_RELEASE_DIR:-$REPO_DIR/apps/imsg/desktop/releases}"
CURRENT_MANIFEST="$RELEASE_DIR/current.json"
PUBLISHED_SHA="$(plutil -extract sourceSha raw -o - "$CURRENT_MANIFEST" 2>/dev/null || true)"
PUBLISHED_CHECKSUM="$(plutil -extract sha256 raw -o - "$CURRENT_MANIFEST" 2>/dev/null || true)"
PUBLISHED_SIZE="$(plutil -extract size raw -o - "$CURRENT_MANIFEST" 2>/dev/null || true)"
PUBLISHED_BUILT_AT="$(plutil -extract builtAt raw -o - "$CURRENT_MANIFEST" 2>/dev/null || true)"
PUBLISHED_SEMVER="$(plutil -extract semver raw -o - "$CURRENT_MANIFEST" 2>/dev/null || true)"
PUBLISHED_BUNDLE_ID="$(plutil -extract bundleId raw -o - "$CURRENT_MANIFEST" 2>/dev/null || true)"
PUBLISHED_URL="$(plutil -extract artifactUrl raw -o - "$CURRENT_MANIFEST" 2>/dev/null || true)"
PUBLISHED_ARTIFACT="$RELEASE_DIR/$PUBLISHED_SHA/Comma-${PUBLISHED_SHA}.app.zip"
if [[ ! "$PUBLISHED_SHA" =~ ^[0-9a-f]{40}$ ]] \
  || [[ ! "$PUBLISHED_CHECKSUM" =~ ^[0-9a-f]{64}$ ]] \
  || [[ ! "$PUBLISHED_SIZE" =~ ^[1-9][0-9]*$ ]] \
  || [[ ! "$PUBLISHED_BUILT_AT" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
  || [[ ! "$PUBLISHED_SEMVER" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$ ]] \
  || [ "$PUBLISHED_BUNDLE_ID" != "com.milad.imsg.desktop" ] \
  || [[ "$PUBLISHED_URL" != https://*/"Comma-${PUBLISHED_SHA}.app.zip" ]] \
  || [ ! -f "$PUBLISHED_ARTIFACT" ] \
  || [ "$PUBLISHED_CHECKSUM" != "$(shasum -a 256 "$PUBLISHED_ARTIFACT" 2>/dev/null | cut -d ' ' -f 1)" ] \
  || [ "$PUBLISHED_SIZE" != "$(stat -f %z "$PUBLISHED_ARTIFACT" 2>/dev/null || true)" ]; then
  exit 0
fi
if [ -z "$LAST_DEPLOYED_SHA" ] \
  || ! git -C "$REPO_DIR" cat-file -e "${LAST_DEPLOYED_SHA}^{commit}" 2>/dev/null; then
  exit 0
fi

if git -C "$REPO_DIR" diff --quiet "$LAST_DEPLOYED_SHA" "$CURRENT_SHA" -- \
  apps/imsg/desktop \
  apps/imsg/scripts/desktop-activate.sh \
  apps/imsg/scripts/desktop-app-verify.sh \
  apps/imsg/scripts/desktop-build-release.sh \
  apps/imsg/scripts/desktop-swap-apps.py; then
  exit 1
fi
exit 0
