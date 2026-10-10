# Comma hill-climb changelog

One entry per landed change, newest first. Each entry gives the date, the commit, what changed for the user, the metric before and after, and how to revert.

## 2026-10-10. The connection starts with the page, not after the app loads (1202bb26)

- **For the user:** opening a conversation right after reopening Comma is about a quarter second faster. The page now starts the Convex connection and the sign-in token in its first lines, while the app's code is still downloading. Before, the connection waited for the app to load, then spent 200 to 330 ms on Convex's handshake.
- **Metric 1c (production return visit, open right after load, p75):** production 350 to 558 ms became 187 to 224 ms on the preview, over three interleaved rounds with no overlap. On a fresh load the list was equal or faster (round p75s 832, 531 and 628 ms against 826, 944 and 882).
- **Ratchet:** `post-export.test.ts` requires the boot script ahead of the bundle. `convex-token.test.ts` and `boot-handoff.test.ts` pin that the early token is used once, that a forced refresh never uses it, and that a mismatched or closed socket is replaced.
- **Revert:** `git revert 1202bb26`.

## 2026-10-10. Correction: font preloads removed

H10 was measured and rejected, but its revert commit (4dec178d) carried H10's own change, so production preloaded both fonts from 13:00 until 00c8e140. 00c8e140 removes the preloads again.

## 2026-10-10. Lens tabs keep their place as counts fill in (53308655)

- **For the user:** on a fresh load, Waiting and All no longer shuffle sideways while the Needs reply and Unread counts climb from one digit to two.
- **Metric 3a (production first visit, layout shifts per load, median of 3):** production 7, 5 and 8 against the preview's 2, 4 and 4 in interleaved rounds. First-visit list p75 was unchanged (745 and 788 ms against 733 and 735 ms).
- **Revert:** `git revert 53308655`.

## 2026-10-10. Lens counts hold steady while the list loads (79c2b20d)

- **For the user:** on reopening Comma, the Unread and Waiting counts no longer drop and climb back over the first second and a half, and the lens tabs no longer slide as they do. The saved list stays in place until the live list has fully arrived.
- **Metric 3a (production return visit, layout shifts per load, median):** production went from 6 to 0 on the preview, in three interleaved rounds of three loads. List and open times overlapped between the two sides, so there is no cost.
- **Ratchet:** `bridgeSnapshot` unit tests in `client/src/lib/chat-snapshot.test.ts` fail if the first live page replaces the saved list again.
- **Revert:** `git revert 79c2b20d`.

## 2026-10-10. Fonts and icons are cached for good (ec8d5eda)

- **For the user:** icons and the header font come from the browser cache instantly instead of being rechecked with the Mac mini on every load. That stopped them drawing a frame late and nudging the sidebar header.
- **Metric 3a (fixture, tailnet network, return visit, median of 5):** 6 went to 0 in two rounds each. List time was unchanged: p75 224 to 226 ms before, 221 to 224 ms after.
- **Ratchet:** `server/static-cache.test.ts` requires hashed `/assets/` files to be immutable.
- **Revert:** `git revert ec8d5eda`.

## 2026-10-10. The sidebar header holds still while the app loads (ab4226b7)

- **For the user:** the search box, the lens tabs and their counts no longer jump after the window first paints, and "Select a conversation" no longer slides down. Icons and the header font now load before the first frame, and the counts hold their space until the list arrives.
- **Metric 3a (layout shifts after first paint, desktop fixture, median of 5):** first visit 5 to 7 went to 0, return visit 8 to 0, and list delayed 1.5 s 7 to 10 to 0. Load time did not change: interleaved A/B list p75 was 489 to 610 ms before against 484 to 564 ms after.
- **Ratchet:** `ratchet.playwright.ts` withholds the list for 1.5 s and fails on any shift in the queue header. The old build produced 38 header shifts.
- **Revert:** `git revert ab4226b7`.

## 2026-10-10. Tapbacks, edits, unsend and delete land on the frame you act (3bf6fd43)

- **For the user:** a tapback, an edit, Undo send and Delete for Me now show on the frame of the click. If the Mac mini rejects one, it reverts with a toast. Before, a tapback showed after a server round trip, and the other three waited for it.
- **Metric 2 (non-optimistic interactions):** 84 became 80. `e2e/bench/optimistic.ts`, fixture with tailnet shaping, p75: tapback add 298 to 15 ms, tapback remove 465 to 15 ms, unsend 399 to 15 ms.
- **Ratchet:** `ratchet.playwright.ts` requires the tapback badge within 50 ms of the click, and requires the badge to roll back with a toast under an injected bridge fault.
- **Revert:** `git revert 3bf6fd43`.

## 2026-10-10. Contacts loads on first visit, not at boot (c744ed02)

- **For the user:** the conversation list appears sooner on a fresh load, because the 440 KB contacts list no longer downloads alongside it. Contacts still opens instantly after its first visit.
- **Metric 1a (first-visit cold load, real data, p75):** 936 to 1,383 ms on production became 753 to 815 ms on the branch preview, measured in three interleaved rounds of five.
- **Ratchet:** `e2e/fixture/ratchet.playwright.ts` fails if Contacts mounts at boot. It runs in `validate-imsg.yml`.
- **Revert:** `git revert` c744ed02.

## 2026-10-10. Measurement harness

- **For the user:** nothing changes. This lands the benchmarks every later entry is measured with.
- **Metric:** baselines recorded in [README.md](README.md).
- **Revert:** `git revert` this commit. No runtime code changed.
