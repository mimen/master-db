#!/usr/bin/env bash
# Read-only: is the instance this skill started worth driving? Exit 0 only if every check passes.
set -uo pipefail

repo="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
state="${TMPDIR:-/tmp}/verify-imsg"
failed=0
check() { # check <ok?> <pass message> <fail message>
  if [[ "$1" == 1 ]]; then echo "OK    $2"; else echo "FAIL  $3"; failed=1; fi
}

if [[ ! -f "$state/pid" ]]; then echo "FAIL  no instance started by this skill (run launch.sh)"; exit 1; fi
pid="$(cat "$state/pid")"; port="$(cat "$state/port")"; built="$(cat "$state/sha")"

kill -0 "$pid" 2>/dev/null && alive=1 || alive=0
check "$alive" "process $pid alive" "process $pid is gone; see $state/server.log"

owner="$(lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -1)"
[[ "$owner" == "$pid" ]] && owned=1 || owned=0
check "$owned" "port $port owned by our process" "port $port owned by '${owner:-nobody}', not $pid"

health="$(curl -fsS "http://127.0.0.1:$port/api/health" 2>/dev/null)"
[[ -n "$health" ]] && healthy=1 || healthy=0
check "$healthy" "/api/health answers" "/api/health does not answer"

[[ -f "$repo/apps/imsg/e2e/fixture/dist/index.html" ]] && bundled=1 || bundled=0
check "$bundled" "fixture web bundle present" "fixture bundle missing; relaunch without --skip-build"

head="$(git -C "$repo" rev-parse --short HEAD)"
if [[ "$head" == "$built" ]]; then echo "OK    built from HEAD $head"
else echo "WARN  built from $built but HEAD is $head; relaunch to verify current code"; fi

exit $failed
