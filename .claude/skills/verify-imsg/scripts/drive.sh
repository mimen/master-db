#!/usr/bin/env bash
# Run one Playwright drive script against the instance launch.sh started.
# Usage: drive.sh <spec.ts> <feature-id>
#   <spec.ts> imports { test, expect } from "../fixtures/desk" (see SKILL.md).
#   Evidence lands in <state dir>/evidence/<feature-id>/ (see state.sh).
set -uo pipefail

spec="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
feature="${2:?feature id required, e.g. send-text}"
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/state.sh"
imsg="$repo/apps/imsg"

"$here/doctor.sh" >/dev/null || { "$here/doctor.sh"; exit 1; }

evidence="$state/evidence/$feature"
rm -rf "$evidence" && mkdir -p "$evidence"
# The fixture config only collects e2e/fixture/*.playwright.ts, so the drive is staged there
# for the run and removed afterwards; it never lands in git.
run="$imsg/e2e/fixture/verify-imsg-$feature.playwright.ts"
cp "$spec" "$run"
# Drives always record video and a trace: a verification run is evidence, so a passing run
# must be auditable too. The config sits beside the fixture config so it resolves Playwright.
config="$imsg/e2e/verify-imsg.playwright.config.ts"
cat >"$config" <<'TS'
import { defineConfig } from "@playwright/test";
import base from "./fixture.playwright.config";
export default defineConfig({ ...base, use: { ...base.use, video: "on", trace: "on", screenshot: "on" } });
TS
trap 'rm -f "$run" "$config"' EXIT

cd "$imsg"
VERIFY_IMSG_EVIDENCE="$evidence" IMSG_FIXTURE_PORT="$(cat "$state/port")" \
  bunx playwright test --config "$config" \
  --output "$evidence/playwright" "verify-imsg-$feature" 2>&1 | tee "$evidence/run.log"
status=${PIPESTATUS[0]}
# Lift the recording next to the other evidence so a reviewer finds it without digging.
video="$(find "$evidence/playwright" -name '*.webm' | head -1)"
[[ -n "$video" ]] && cp "$video" "$evidence/video.webm"
echo "verify-imsg: $feature exit $status; evidence in $evidence"
exit "$status"
