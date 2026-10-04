#!/usr/bin/env bash
# Run one Playwright drive script against the instance launch.sh started.
# Usage: drive.sh <spec.ts> <feature-id>
#   <spec.ts> imports { test, expect } from "../fixtures/desk" (see SKILL.md).
#   Evidence lands in $TMPDIR/verify-imsg/evidence/<feature-id>/.
set -uo pipefail

spec="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
feature="${2:?feature id required, e.g. send-text}"
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(git -C "$here" rev-parse --show-toplevel)"
imsg="$repo/apps/imsg"
state="${TMPDIR:-/tmp}/verify-imsg"

"$here/doctor.sh" >/dev/null || { "$here/doctor.sh"; exit 1; }

evidence="$state/evidence/$feature"
rm -rf "$evidence" && mkdir -p "$evidence"
# The fixture config only collects e2e/fixture/*.playwright.ts, so the drive is staged there
# for the run and removed afterwards; it never lands in git.
run="$imsg/e2e/fixture/verify-imsg-$feature.playwright.ts"
cp "$spec" "$run"
trap 'rm -f "$run"' EXIT

cd "$imsg"
VERIFY_IMSG_EVIDENCE="$evidence" IMSG_FIXTURE_PORT="$(cat "$state/port")" \
  bunx playwright test --config e2e/fixture.playwright.config.ts \
  --output "$evidence/playwright" "verify-imsg-$feature" 2>&1 | tee "$evidence/run.log"
status=${PIPESTATUS[0]}
echo "verify-imsg: $feature exit $status; evidence in $evidence"
exit "$status"
