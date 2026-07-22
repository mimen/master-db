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
git fetch origin main
git checkout main
git pull --ff-only origin main
echo "Deployed commit: $(git rev-parse --short HEAD) $(git log -1 --pretty=%s)"

echo "== Installing deps =="
bun install
bun install --cwd apps/imsg
bun install --cwd apps/imsg/client

echo "== Typecheck =="
bun run typecheck:imsg

echo "== Building web client =="
cd apps/imsg/client
rm -rf dist
BUILD_LOG="$(mktemp)"
bun x expo export --platform web >"$BUILD_LOG" 2>&1 &
BUILD_PID=$!

# Known quirk: `expo export` can finish writing dist/ and then hang instead
# of exiting. Poll for the post-export markers (added by post-export.ts) or
# for the process exiting on its own; if neither happens within the window,
# kill it and run post-export.ts by hand.
DONE=0
for _ in $(seq 1 36); do # ~3 min
  if ! kill -0 "$BUILD_PID" 2>/dev/null; then
    DONE=1
    break
  fi
  if grep -q "manifest.webmanifest" dist/index.html 2>/dev/null; then
    echo "export finished writing dist/, killing the hung process"
    kill "$BUILD_PID" 2>/dev/null || true
    DONE=1
    break
  fi
  sleep 5
done

if [ "$DONE" -eq 0 ]; then
  echo "export did not finish in time"
  cat "$BUILD_LOG"
  kill "$BUILD_PID" 2>/dev/null || true
  exit 1
fi

if ! grep -q "manifest.webmanifest" dist/index.html 2>/dev/null; then
  echo "dist/ looks incomplete, running post-export manually"
  bun scripts/post-export.ts
fi

cd "$REPO_DIR"

echo "== Restarting imsg server =="
launchctl kickstart -k "gui/$(id -u)/com.milad.imsg"
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
