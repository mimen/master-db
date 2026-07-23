#!/usr/bin/env bash
# Deploys imsg in place on this machine: the live app runs directly out of
# this git checkout (server/index.ts serves both the API and the built
# client/dist/ SPA — see server/index.ts's "static app" section), so
# deploying means pull + reinstall + rebuild + restart, not a separate
# artifact push. Intended to run FROM the live checkout (e.g.
# ~/Programming/Repos/master-db on the Mini), invoked by the
# deploy-imsg GitHub Actions workflow on a self-hosted runner living on
# that same machine.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO_DIR"

echo "== Syncing main =="
# Anything dirty here is accidental (manual debugging, an interrupted run) —
# this checkout exists only to deploy. Reset tracked files so the ff-only
# pull can never abort on local modifications; untracked files (.env) survive.
git checkout -- .
git fetch origin main
git checkout main
git pull --ff-only origin main
echo "Deployed commit: $(git rev-parse --short HEAD) $(git log -1 --pretty=%s)"

echo "== Installing deps =="
# Frozen: a deploy must install exactly what's committed, never rewrite
# lockfiles (which would dirty this tree and break the next pull).
bun install --frozen-lockfile
bun install --frozen-lockfile --cwd apps/imsg
bun install --frozen-lockfile --cwd apps/imsg/client

echo "== Typecheck =="
bun run typecheck:imsg

echo "== Building web client =="
cd apps/imsg/client
rm -rf dist
BUILD_LOG="$(mktemp)"
bun x expo export --platform web >"$BUILD_LOG" 2>&1 &
BUILD_PID=$!

# Known quirk: `expo export` can finish writing dist/ and then hang instead
# of exiting. Its stdout is block-buffered once redirected to a file (not a
# TTY), so grepping the log for a completion line is unreliable — it may not
# land until the process is killed. Poll the filesystem instead: index.html
# is one of the last things written, so its presence (plus the JS bundle) is
# a reliable completion signal independent of stdio buffering. Then always
# kill the process and run post-export.ts ourselves (it's what adds the
# PWA/manifest tags — never already present before this, so it's not a valid
# completion signal itself).
DONE=0
for _ in $(seq 1 72); do # ~6 min
  if ! kill -0 "$BUILD_PID" 2>/dev/null; then
    DONE=1
    break
  fi
  if [ -f dist/index.html ] && compgen -G "dist/_expo/static/js/web/*.js" >/dev/null; then
    DONE=1
    break
  fi
  sleep 5
done

sleep 2 # let any final in-flight writes settle before we kill/read dist/
if kill -0 "$BUILD_PID" 2>/dev/null; then
  echo "killing the export process (finished or not, past the wait window)"
  kill "$BUILD_PID" 2>/dev/null || true
fi

if [ "$DONE" -eq 0 ]; then
  echo "export did not finish in time"
  cat "$BUILD_LOG"
  exit 1
fi

echo "running post-export"
bun scripts/post-export.ts

cd "$REPO_DIR"

echo "== Restarting imsg server =="
launchctl kickstart -k "gui/$(id -u)/com.milad.imsg"
# Metro caches its file map — a new source DIRECTORY is invisible to a
# long-running bundler, breaking Expo Go with "Unable to resolve module".
launchctl kickstart -k "gui/$(id -u)/com.milad.imsg-expo" 2>/dev/null || true
sleep 3

echo "== Health check =="
launchctl print "gui/$(id -u)/com.milad.imsg" | grep -E "state|pid"
PORT="${IMSG_PORT:-8377}"
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "http://localhost:${PORT}/")
echo "imsg http status: ${STATUS}"
if [ "$STATUS" != "200" ]; then
  echo "health check failed"
  exit 1
fi
echo "Deploy OK: $(git rev-parse --short HEAD)"
