#!/usr/bin/env bash
# Stop only the instance this skill started. Evidence under the checkout's state dir survives.
set -uo pipefail

. "$(dirname "$0")/state.sh"
if [[ -f "$state/pid" ]]; then
  pid="$(cat "$state/pid")"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid"
  fi
  echo "verify-imsg: stopped pid $pid"
fi
rm -f "$state/pid" "$state/port" "$state/sha"
rm -rf "$state/specs"
echo "verify-imsg: evidence kept in $state/evidence"
