#!/usr/bin/env bash
# Start one imsg fixture instance for verification and wait until it answers.
# Usage: launch.sh [--skip-build]
set -euo pipefail

repo="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
imsg="$repo/apps/imsg"
port="${IMSG_FIXTURE_PORT:-8399}"
state="${TMPDIR:-/tmp}/verify-imsg"
mkdir -p "$state"

if [[ -f "$state/pid" ]] && kill -0 "$(cat "$state/pid")" 2>/dev/null; then
  echo "verify-imsg: an instance this skill started is already running (pid $(cat "$state/pid")); run cleanup.sh first" >&2
  exit 1
fi
if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "verify-imsg: port $port is held by a process this skill did not start; refusing to double-drive it" >&2
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >&2
  exit 1
fi

cd "$imsg"
# A stale install fails the Expo export with misleading config-plugin errors.
for dir in "$repo" "$imsg" "$imsg/client"; do
  (cd "$dir" && bun install --frozen-lockfile >/dev/null 2>&1) || { echo "verify-imsg: bun install failed in $dir" >&2; exit 1; }
done
[[ -f "$imsg/client/expo-env.d.ts" ]] || printf '/// <reference types="expo/types" />\n' >"$imsg/client/expo-env.d.ts"
if [[ "${1:-}" != "--skip-build" ]]; then
  bun run fixture:build >"$state/build.log" 2>&1 || { tail -20 "$state/build.log" >&2; exit 1; }
fi

IMSG_FIXTURE_PORT="$port" nohup bun --no-env-file e2e/fixture/start.ts >"$state/server.log" 2>&1 &
echo $! >"$state/pid"
echo "$port" >"$state/port"
git -C "$repo" rev-parse --short HEAD >"$state/sha"

for _ in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then
    echo "verify-imsg: ready at http://127.0.0.1:$port (pid $(cat "$state/pid"), build $(cat "$state/sha"))"
    exit 0
  fi
  kill -0 "$(cat "$state/pid")" 2>/dev/null || { tail -20 "$state/server.log" >&2; exit 1; }
  sleep 0.5
done
echo "verify-imsg: fixture did not answer /api/health within 60s" >&2
tail -20 "$state/server.log" >&2
exit 1
