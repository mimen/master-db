#!/usr/bin/env bash
# Deploys imsg in place on the Mini from its canonical production checkout.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CANONICAL_REPO="$HOME/Programming/Repos/master-db"
[ "$REPO_DIR" = "$CANONICAL_REPO" ] || { printf 'production deploy must run from %s\n' "$CANONICAL_REPO" >&2; exit 1; }
ALREADY_SYNCED=0
if [ "${1:-}" = "--already-synced" ]; then ALREADY_SYNCED=1; shift; fi
[ "$#" -eq 0 ] || { printf 'unknown deploy argument: %s\n' "$1" >&2; exit 2; }
cd "$REPO_DIR"
DEPLOY_STATE_DIR="${IMSG_DEPLOY_STATE_DIR:-$HOME/Library/Application Support/imsg-deploy}"
LAST_DEPLOYED_SHA_FILE="$DEPLOY_STATE_DIR/last-deployed-sha"
WEB_RELEASE_MANIFEST="$DEPLOY_STATE_DIR/web-release.json"
WEB_MANIFEST_BACKUP="$DEPLOY_STATE_DIR/.web-release.backup.$$"
LAST_DEPLOYED_SHA=""
WEB_STAGING=""
WEB_ROLLBACK_ARCHIVE=""
WEB_ACTIVATED=0
WEB_MANIFEST_SNAPSHOTTED=0
WEB_MANIFEST_EXISTED=0
SHELL_POINTER_PUBLISHED=0
SHELL_POINTER_EXISTED=0
DEPLOY_SUCCEEDED=0
PREVIOUS_SHELL_SHA=""
if [ -f "$LAST_DEPLOYED_SHA_FILE" ]; then
  LAST_DEPLOYED_SHA="$(tr -d '[:space:]' <"$LAST_DEPLOYED_SHA_FILE")"
fi
if [ -f "$REPO_DIR/apps/imsg/desktop/releases/current.json" ]; then
  SHELL_POINTER_EXISTED=1
  PREVIOUS_SHELL_SHA="$(plutil -extract sourceSha raw -o - "$REPO_DIR/apps/imsg/desktop/releases/current.json" 2>/dev/null || true)"
fi

cleanup() {
  local status=$?
  set +e
  [ -z "$WEB_STAGING" ] || rm -rf "$WEB_STAGING"
  if [ "$status" -ne 0 ] && [ "$DEPLOY_SUCCEEDED" -eq 0 ]; then
    if [ "$WEB_ACTIVATED" -eq 1 ]; then
      if [ -n "$WEB_ROLLBACK_ARCHIVE" ]; then
        printf 'Rolling back active web dist after failed deploy\n' >&2
        /usr/bin/python3 apps/imsg/scripts/web-activate.py rollback \
          "$REPO_DIR/apps/imsg/client/dist" "$WEB_ROLLBACK_ARCHIVE"
      else
        rm -rf "$REPO_DIR/apps/imsg/client/dist"
      fi
    fi
    if [ "$WEB_MANIFEST_SNAPSHOTTED" -eq 1 ]; then
      if [ "$WEB_MANIFEST_EXISTED" -eq 1 ] && [ -f "$WEB_MANIFEST_BACKUP" ]; then
        mv "$WEB_MANIFEST_BACKUP" "$WEB_RELEASE_MANIFEST"
      elif [ "$WEB_MANIFEST_EXISTED" -eq 0 ]; then
        rm -f "$WEB_RELEASE_MANIFEST"
      fi
    fi
    if [ "$SHELL_POINTER_PUBLISHED" -eq 1 ]; then
      if [[ "$PREVIOUS_SHELL_SHA" =~ ^[0-9a-f]{40}$ ]]; then
        if ! apps/imsg/scripts/desktop-build-release.sh --publish-current "$PREVIOUS_SHELL_SHA"; then
          printf 'failed to restore prior shell release pointer %s\n' "$PREVIOUS_SHELL_SHA" >&2
        fi
      elif [ "$SHELL_POINTER_EXISTED" -eq 0 ]; then
        rm -f "$REPO_DIR/apps/imsg/desktop/releases/current.json"
      fi
    fi
  fi
  rm -f "$WEB_MANIFEST_BACKUP"
  return "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "$ALREADY_SYNCED" -eq 0 ]; then
  printf '== Syncing main ==\n'
  git checkout -- .
  git fetch origin main
  git checkout main
  git pull --ff-only origin main
fi
DEPLOYED_SHA="$(git rev-parse HEAD)"
printf 'Deployed commit: %s %s\n' "${DEPLOYED_SHA:0:7}" "$(git log -1 --pretty=%s)"

SHELL_RELEASE_REQUIRED=0
if apps/imsg/scripts/desktop-release-needed.sh "$REPO_DIR" "$LAST_DEPLOYED_SHA" "$DEPLOYED_SHA"; then
  SHELL_RELEASE_REQUIRED=1
  printf 'Desktop release inputs changed since %s\n' "${LAST_DEPLOYED_SHA:-the last recorded deploy}"
else
  status=$?
  [ "$status" -eq 1 ] || exit "$status"
fi

printf '== Installing deps ==\n'
bun install --frozen-lockfile
bun install --frozen-lockfile --cwd apps/imsg
bun install --frozen-lockfile --cwd apps/imsg/client
bun install --frozen-lockfile --cwd apps/imsg/desktop

# Expo generates route definitions only while its resident server is running.
printf '== Refreshing Expo route types ==\n'
ROUTE_TYPES="apps/imsg/client/.expo/types/router.d.ts"
types_mtime() { stat -f %m "$ROUTE_TYPES" 2>/dev/null || printf '0\n'; }
BEFORE="$(types_mtime)"
launchctl kickstart -k "gui/$(id -u)/com.milad.imsg-expo" 2>/dev/null || true
for _ in $(seq 1 10); do
  sleep 3
  [ "$(types_mtime)" != "$BEFORE" ] && break
done

printf '== Typecheck ==\n'
bun run typecheck:imsg

printf '== Lint ==\n'
(cd apps/imsg && bun run lint)

printf '== Tests ==\n'
(cd apps/imsg && bun test)

printf '== Building staged web release ==\n'
WEB_STAGING="$REPO_DIR/apps/imsg/client/.dist-staging-${DEPLOYED_SHA}.$$"
/bin/bash apps/imsg/scripts/build-web-release.sh "$DEPLOYED_SHA" "$WEB_STAGING"

if [ "$SHELL_RELEASE_REQUIRED" -eq 1 ]; then
  printf '== Building immutable Comma shell release ==\n'
  /bin/zsh -c 'unset PROCID PROCID_REF PROCID_OFF; exec -a comma:shell-builder "$@"' \
    comma:shell-builder apps/imsg/scripts/desktop-build-release.sh --build "$DEPLOYED_SHA"
fi

printf '== Atomically activating completed web dist ==\n'
PREVIOUS_WEB_SHA=""
mkdir -p "$DEPLOY_STATE_DIR"
if [ -f "$WEB_RELEASE_MANIFEST" ]; then
  PREVIOUS_WEB_SHA="$(plutil -extract webSha raw -o - "$WEB_RELEASE_MANIFEST" 2>/dev/null || true)"
  cp "$WEB_RELEASE_MANIFEST" "$WEB_MANIFEST_BACKUP"
  WEB_MANIFEST_EXISTED=1
fi
WEB_MANIFEST_SNAPSHOTTED=1
WEB_ROLLBACK_ARCHIVE="$(/usr/bin/python3 apps/imsg/scripts/web-activate.py activate \
  "$WEB_STAGING" \
  "$REPO_DIR/apps/imsg/client/dist" \
  "$REPO_DIR/apps/imsg/client/web-releases" \
  "$PREVIOUS_WEB_SHA" \
  "${IMSG_WEB_RELEASE_RETENTION:-2}")"
WEB_ACTIVATED=1
WEB_STAGING=""

printf '== Installing production process identities ==\n'
/bin/bash apps/imsg/scripts/install-mini-launchagents.sh --repo "$REPO_DIR"

printf '== Configuring tailnet HTTPS ==\n'
TAILSCALE_BIN="${TAILSCALE_BIN:-/Applications/Tailscale.app/Contents/MacOS/Tailscale}"
IMSG_TAILNET_URL="${IMSG_TAILNET_URL:-https://milads-mac-mini.taild31e9a.ts.net:8447}"
"$TAILSCALE_BIN" serve --bg --yes --https=8447 http://127.0.0.1:8377

printf '== Restarting production services ==\n'
launchctl kickstart -k "gui/$(id -u)/com.milad.imsg"
launchctl kickstart -k "gui/$(id -u)/com.milad.imsg-expo" 2>/dev/null || true
sleep 3

printf '== Health checks ==\n'
launchctl print "gui/$(id -u)/com.milad.imsg" | /usr/bin/grep -E "state|pid"
PORT="${IMSG_PORT:-8377}"
for target in "http://127.0.0.1:${PORT}" "$IMSG_TAILNET_URL"; do
  HEALTH_STATUS=""
  ROOT_STATUS=""
  for _ in $(seq 1 20); do
    HEALTH_STATUS="$(/usr/bin/curl -sS --max-time 5 -o /dev/null -w "%{http_code}" "$target/api/health" || true)"
    ROOT_STATUS="$(/usr/bin/curl -sS --max-time 5 -o /dev/null -w "%{http_code}" "$target/" || true)"
    [ "$HEALTH_STATUS" = "200" ] && [ "$ROOT_STATUS" = "200" ] && break
    sleep 2
  done
  printf '%s health/root: %s/%s\n' "$target" "${HEALTH_STATUS:-unreachable}" "${ROOT_STATUS:-unreachable}"
  [ "$HEALTH_STATUS" = "200" ] && [ "$ROOT_STATUS" = "200" ] || { printf 'production health check failed: %s\n' "$target" >&2; exit 1; }
  bun apps/imsg/scripts/verify-served-web.ts "$target" "$DEPLOYED_SHA"
done

# Release pointers move only after the restarted service serves the completed dist.
printf '== Publishing verified release identity ==\n'
mkdir -p "$DEPLOY_STATE_DIR"
printf '{"environment":"production","branch":null,"webSha":"%s"}\n' "$DEPLOYED_SHA" \
  >"${WEB_RELEASE_MANIFEST}.tmp.$$"
mv "${WEB_RELEASE_MANIFEST}.tmp.$$" "$WEB_RELEASE_MANIFEST"

if [ "$SHELL_RELEASE_REQUIRED" -eq 1 ]; then
  SHELL_POINTER_PUBLISHED=1
  /bin/zsh -c 'unset PROCID PROCID_REF PROCID_OFF; exec -a comma:shell-publisher "$@"' \
    comma:shell-publisher apps/imsg/scripts/desktop-build-release.sh --publish-current "$DEPLOYED_SHA"
fi

PUBLISHED_WEB_SHA="$(/usr/bin/curl -sf --max-time 15 "$IMSG_TAILNET_URL/api/deploy/status" | plutil -extract webSha raw -o - -- -)"
[ "$PUBLISHED_WEB_SHA" = "$DEPLOYED_SHA" ] || { printf 'published web release identity did not reach production\n' >&2; exit 1; }
if [ "$SHELL_RELEASE_REQUIRED" -eq 1 ]; then
  PUBLISHED_SHELL_SHA="$(/usr/bin/curl -sf --max-time 15 "$IMSG_TAILNET_URL/api/desktop-release" | plutil -extract sourceSha raw -o - -- -)"
  [ "$PUBLISHED_SHELL_SHA" = "$DEPLOYED_SHA" ] || { printf 'published shell release identity did not reach production\n' >&2; exit 1; }
fi

printf '%s\n' "$DEPLOYED_SHA" >"${LAST_DEPLOYED_SHA_FILE}.tmp.$$"
mv "${LAST_DEPLOYED_SHA_FILE}.tmp.$$" "$LAST_DEPLOYED_SHA_FILE"
DEPLOY_SUCCEEDED=1
printf 'Deploy OK: %s\n' "${DEPLOYED_SHA:0:7}"
