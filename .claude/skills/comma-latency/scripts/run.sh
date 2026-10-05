#!/bin/bash
set -euo pipefail
umask 077
baseline=""
if [ "$#" -gt 0 ]; then
  if [ "$#" -ne 2 ] || [ "$1" != "--baseline" ] || [ ! -f "$2" ]; then
    echo "usage: run.sh [--baseline /absolute/path/baseline.json]" >&2
    exit 2
  fi
  baseline="$2"
fi
skill="$(cd "$(dirname "$0")/.." && pwd)"
root="$(git -C "$skill" rev-parse --show-toplevel)"
lock="${TMPDIR:-/tmp}/comma-latency-session.lock"
if ! mkdir "$lock" 2>/dev/null; then
  echo "A latency run owns $lock. Verify its owner before removing a stale lock." >&2
  exit 1
fi
printf '%s\n' "$$" > "$lock/pid"
trap 'rm -f "$lock/pid"; rmdir "$lock"' EXIT
out="/Users/mimen/Programming/Repos/convex-db/apps/imsg/artifacts/latency/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$out"
uptime > "$out/load.txt"
curl -fsS --max-time 10 https://milads-mac-mini.taild31e9a.ts.net:8447/api/deploy/status > "$out/deploy-status.json"
"$skill/scripts/native.sh" --self-test
"$skill/scripts/native.sh" --calibrate > "$out/calibration.json"
native_options=(--run --output "$out/native" --repeats 5)
if [ -n "$baseline" ]; then native_options+=(--comma-only); fi
"$skill/scripts/native.sh" "${native_options[@]}"
(
  cd "$root/apps/imsg"
  bun "$skill/scripts/webkit-proxy.ts" --out "$out" --reps 5
  bun "$skill/scripts/webkit-proxy.ts" --out "$out/preview-proxy" --reps 5 --only preview.switch
)
sources=(--native "$out/native/native.json")
remaining="$(python3 - "$out" <<'PY'
import json,sys
from pathlib import Path
p=Path(sys.argv[1])
runs=json.loads((p/'native/native.json').read_text())
comma=next((r for r in runs if r['app']=='Comma'), None)
preview=json.loads((p/'preview-proxy/webkit-proxy.json').read_text())
verified=any('markRead attempts during preview: 0' in r.get('notes',[]) for r in preview['results'])
print(max(0,int(82000-comma['elapsedMs'])) if comma and comma['cleanupVerified'] and not comma.get('error') and verified else 0)
PY
)"
if [ "$remaining" -gt 5000 ]; then
  "$skill/scripts/native.sh" --run --preview-only --budget-ms "$remaining" --output "$out/native-preview" --repeats 5
  sources+=(--native "$out/native-preview/native.json")
  "$skill/scripts/native.sh" --build-info > "$out/native-build.json"
fi
build="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("webSha", "unknown"))' "$out/deploy-status.json")"
report_options=("$out" "${sources[@]}" --build "$build")
if [ -n "$baseline" ]; then report_options+=(--baseline "$baseline"); fi
python3 "$skill/scripts/report.py" "${report_options[@]}"
printf '\nReport: %s/report.md\n' "$out"
