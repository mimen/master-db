---
name: comma-latency
description: Compare Comma.app responsiveness with Messages.app using deterministic native input and retained screen frames. Use when asked "how snappy is Comma", "compare to Messages", "measure latency", "is it faster now", or for before/after checks on performance work. Reports unavailable interactions rather than bypassing read-only safeguards.
---

# Comma latency

Measure the installed macOS apps with [the runner](scripts/run.sh). This is a native timing instrument, not the browser-fixture verification covered by [verify-imsg](../verify-imsg/SKILL.md).

## Run

1. Leave Messages.app and `/Users/mimen/Applications/Comma.app` running. Run alone on this Mac. The native process borrows the pointer and aborts on external mouse motion.
2. Run `bash .claude/skills/comma-latency/scripts/native.sh --doctor` from the task checkout. Accessibility, Screen Recording, and an unobscured application window are required. Do not change permission settings automatically.
3. Run `bash .claude/skills/comma-latency/scripts/run.sh`. The default is five repetitions. Artifacts go to `/Users/mimen/Programming/Repos/convex-db/apps/imsg/artifacts/latency/<timestamp>/`, even from a worktree.
4. Read `report.json` before quoting `report.md`. Check each row's successful count, failures, cleanup status, build identity, and retained frame strip. Compare the same interaction and data before making a speedup claim.

## Re-run Comma after a reload

After the owner reloads Comma, reuse the recorded Messages baseline without borrowing Messages again:

```bash
bash .claude/skills/comma-latency/scripts/run.sh --baseline /Users/mimen/Programming/Repos/convex-db/apps/imsg/artifacts/latency/20261005T131416Z/baseline.json
```

The report distinguishes the running web build read from Settings from the deployed build loaded by the fresh proxy. A reload banner means those builds can differ. Do not label resident-app timings with the server's SHA or reload the app automatically.

## Safety and coverage

- **Keep native operations read-only.** The input vocabulary excludes Return and Enter. Deletion requires verified editable-field focus. Existing field contents are preserved; temporary search text is cleared and verified. Mouse takeover stops further synthetic input. Incomplete cleanup is a reported failure, not permission to reclaim the mouse.
- **Do not select conversations through normal clicks.** Production selection automatically enqueues `markRead`, including for already-read chats. The strict native path therefore reports click switching, rapid click switching, and self-chat compose typing as unavailable. It never substitutes another recipient for `+1 925-997-6370`.
- **Label keyboard previews separately.** Comma's j/k glide path is read-only. The runner first checks that the guarded WebKit preview attempts zero `markRead` writes, then measures native previews, their thread scrolling, and details. These are not the requested mouse-click comparison or a verified self-chat pair.
- **Preserve evidence.** Each trial retains raw BGRA region frames, frame timestamps, PNGs, and its outcome. Files may contain private conversations. Do not upload them. Cleanup closes only the runner's calibration window and headless browser; it restores the original frontmost native app.
- **Enforce the time budget.** Native work reserves cleanup time and shares an 82-second budget across Comma's ordinary and preview passes. Missing controls, timeouts, and no-response trials remain explicit.

## Interpret measurements

First response is the first changed region frame after input. Settled is the last changed frame or final gesture input followed by 300ms of quiet; confirmation time includes that additional 300ms. Visual quiet is not proof of backend completion.

ScreenCaptureKit display timestamps and CGEvent posts use the mach clock. Capture requests 240 Hz and records at one pixel per point. The calibration window measures render submission to a displayed frame, capture delivery, and pixel-processing cost. It does not calibrate physical scanout or HID delivery. No overhead is subtracted. Plus/minus one frame accuracy remains unvalidated.

Complete-frame gaps do not establish dropped display frames. Inspect frame pacing during active gestures and the calibration overhead. A rapid preview may still show pixels from the preceding navigation; such overlap is recorded but excluded from latency summaries when attribution is uncertain.

The WebKit proxy blocks outgoing mutations and actions. Its event-to-DOM/rAF timings exclude the native input and compositor paths. Cross-interaction Pearson correlation is descriptive, not a conversion from proxy milliseconds to Comma.app milliseconds.

## Helpers

| File | Read when |
|---|---|
| [Native build and CLI](scripts/native.sh) | Build, run `--self-test`, inspect `--doctor`, or measure a native pass. |
| [Native measurement owner](native/Benchmark.swift) | Change regions, outcomes, cleanup, or application budgets. |
| [Capture](native/Capture.swift) | Change ScreenCaptureKit sampling or retained frames. |
| [Input](native/Input.swift) | Audit event restrictions and mouse takeover handling. |
| [Calibration](native/Calibration.swift) | Inspect what the pipeline calibration includes. |
| [WebKit proxy](scripts/webkit-proxy.ts) | Inspect guarded headless comparison and `--only preview.switch`. Run from `apps/imsg`. |
| [Proxy regression checks](scripts/webkit-proxy.test.ts) | Run `bun test ../../.claude/skills/comma-latency/scripts/webkit-proxy.test.ts` from `apps/imsg`. |
| [Report reducer](scripts/report.py) | Rebuild summaries and frame strips from retained native JSON without driving apps. |
| [Report checks](scripts/report_test.py) | Run `python3 .claude/skills/comma-latency/scripts/report_test.py` to verify percentiles and failure handling. |

Run the native self-test and the proxy regression checks after instrument changes. Report unsupported coverage plainly; this skill is not a complete native click/compose benchmark.
