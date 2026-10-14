# Comma hill-climb changelog

One entry per landed change, newest first. Each entry gives the date, the commit, what changed for the user, the metric before and after, and how to revert.

## 2026-10-13. Reverted: the crash guard duplicated the conversation list (f766eb21, a9e6dfd3)

- **For the user:** the list shows each conversation once again, the counts are right, and it is fast again. The 10-11 change that kept the app on screen through a Convex timeout (H34) made the list re-subscribe in a loop in production. Every conversation appeared many times, Needs reply and Unread read 999+, and the app slowed to a crawl.
- **Why tests missed it:** the fixture's 18 conversations fit in one page, so the loop never started there.
- **Now guarded by:** `e2e/bench/duplicates.ts`, a read-only check against real data. It counts duplicate rows and list subscriptions, and must pass on a preview before any change to how the list loads lands.
- **Side effect of the revert:** a Convex timeout on the list can again put the app on its crash screen until the guard is redone without the loop.

## 2026-10-11. Cancelling or sending a scheduled message clears its sidebar count on the tap (6711eb8a, c9d6bc02)

- **For the user:** the Scheduled count in the sidebar footer drops with the row on the tap of Cancel or Send now. If the Mac mini rejects it, the row and the count come back. Before, Cancel moved the count only after the mirror caught up (about 600 ms on the fixture), and Send now never cleared it on the fixture.
- **Mechanism:** `lib/pending-scheduled.ts` holds the pending ids outside any one component, the way `pending-flags.ts` holds triage intents. The Scheduled pane and the footer read `listScheduled` through `usePendingScheduled`; an id retires once the bridge confirms and the mirror no longer queues it. The pane's local hidden set is gone.
- **Not done:** the "Has a scheduled message" refinement reads `listScheduled` in conversation-list-pane.tsx, which another agent owns. It needs one change: wrap `useQuery(commaApi.listScheduled, {})` at line 166 in `usePendingScheduled(...)`.
- **Metric 2 (non-optimistic interactions):** 63 became 61. `e2e/bench/optimistic.ts`, 9 interleaved runs against an origin/main build: `scheduled-cancel` p50/p75 614/647 to 14/15 ms; `scheduled-send-now` timed out at 15 s in 9 of 9 runs before, 15/16 ms after.
- **Ratchet:** `ratchet.playwright.ts` requires the footer to drop "pending" within 50 ms of Cancel and of Send now (enqueue held 300 ms), and requires the count and row back under a `deleteScheduledMessage` or `updateScheduledMessage` fault. All four fail on the old build.
- **Fixture:** `e2e/fixture/convex.ts` now executes `sendScheduledNow` through the server's `ScheduledSendNow`.
- **Revert:** `git revert c9d6bc02 6711eb8a`.

## 2026-10-11. A renamed group shows its new name on Save (860113d4)

- **For the user:** saving a new group name in Details shows it there and on the conversation row on the same frame. If the Mac mini rejects it, both go back to the old name and the "Couldn't rename" toast shows. Before, the name changed only once the enqueue was acknowledged, and a bridge failure after that was never reported.
- **Mechanism:** a `rename` intent joins the flag intents in `lib/pending-flags.ts` on its own axis and patches `displayName`; it retires once the directory carries the name. The rename now runs through `runCommand`, so it observes the bridge's result. The unused `api.renameGroup` and `enqueueCommand` are gone.
- **Metric 2 (non-optimistic interactions):** 64 became 63. `e2e/bench/optimistic.ts --case rename-group`, 9 interleaved runs against an origin/main build, p50/p75 80/82 to 13/14 ms.
- **Ratchet:** `ratchet.playwright.ts` requires the new name in Details within 50 ms of Save (rename enqueue held 300 ms) and requires the old name plus the toast under a `renameGroup` fault. Both fail on the old build (310 to 317 ms; the name never shows).
- **Harness:** `IMSG_FIXTURE_DIST` serves another build from the same fixture, and each port keeps its own runtime database, so an A/B pair runs side by side.
- **Revert:** `git revert 860113d4`.

## 2026-10-10. A new message from the palette shows it is sending on the click (H19)

- **For the user:** pressing Send in the ⌘N palette turns the arrow into the composer's Sending ring on that frame. When the one recipient already has a conversation, the palette closes on the next frame and that thread opens with the message at the bottom, marked as sending. If the Mac mini rejects it, the bubble turns Not delivered and the "Couldn't start" toast shows. A brand-new conversation keeps the ring until createChat answers, because there is no thread to show it in yet. Before, the arrow only dimmed and nothing moved until the bridge answered.
- **Metric 2 (non-optimistic interactions):** 70 became 69. `e2e/bench/optimistic.ts --case palette-send` (ring or bubble, whichever first), 9 interleaved runs, p50/p75 298/299 to 38/50 ms. The ring paints about 12 ms after the click in-page; the bench's Playwright-side reading adds the long frame that mounts the thread.
- **Ratchet:** `ratchet.playwright.ts` requires the ring or bubble within 50 ms of Send (createChat enqueue held 300 ms), and requires Not delivered plus the toast under a `createChat` fault. Both fail on the old build (345 to 361 ms; no bubble).
- **Revert:** `git revert <H19 commit>`.

## 2026-10-10. Send again puts the new copy in the thread at once (968c5f26)

- **For the user:** choosing Send again on an older message that may not have delivered adds the new copy at the bottom of the thread on the click, marked as sending, and scrolls to it. If the Mac mini rejects it, the copy turns Not delivered with Retry, and the "Send failed" toast shows. Before, nothing changed until the bridge answered.
- **Metric 2 (non-optimistic interactions):** 71 became 70. `e2e/bench/optimistic.ts --case send-again`, 9 interleaved runs, p50/p75 299/316 to 15/15 ms.
- **Ratchet:** `ratchet.playwright.ts` requires the copy within 50 ms of the click (fixture send delayed 300 ms) and requires Not delivered plus the toast under a `sendText` fault. Both fail on the old build (377 to 395 ms; no copy).
- **Revert:** `git revert 968c5f26`.

## 2026-10-10. A forward opens the destination with the message already in it (17c44107)

- **For the user:** picking a destination in the forward picker closes it and opens that conversation on the same frame, with the forwarded copy at the bottom marked as sending. If the Mac mini rejects it, the bubble turns Not delivered with Retry and the "Forward failed" toast shows. Before, the picker sat unchanged until the bridge answered, then closed with a "Forwarded to" toast.
- **Metric 2 (non-optimistic interactions):** 72 became 71. `e2e/bench/optimistic.ts --case forward`, 9 interleaved runs, p50/p75 415/432 to 17/21 ms.
- **Ratchet:** `ratchet.playwright.ts` requires the forwarded bubble in Jordan's thread within 50 ms of the click (with the fixture's send delayed 300 ms, since the bare fixture can answer inside a frame), and requires Not delivered plus the toast under a `sendText` fault. Both fail on the old build (344 to 360 ms; no bubble).
- **Mechanism:** a thread's own unsettled sends moved from per-thread React state into `lib/local-sends.ts`, a per-chat store the thread reads. A send started outside the thread can now place its temp bubble before the thread mounts. `tempMessage` moved there from composer.tsx.
- **Revert:** `git revert 17c44107`.

## 2026-10-10. A voice message is in the thread the moment you send it (b1fefba8)

- **For the user:** releasing the mic (or clicking Send voice message on the web) puts the audio bubble in the thread on that frame, marked as sending. It becomes playable a beat later, once the recorder hands over the file. If the Mac mini rejects it, the bubble leaves, the existing toast shows, and the take waits in the staging tray with a mic icon so Send resends it as a voice message. Before, the controls only dimmed and nothing appeared until the bridge answered, and a failed take was lost.
- **Metric 2 (non-optimistic interactions):** 73 became 72. `e2e/bench/optimistic.ts --case voice-send`, fixture with tailnet shaping, 9 interleaved runs, p50/p75 518/534 to 15/15 ms.
- **Ratchet:** `ratchet.playwright.ts` requires the audio bubble within 50 ms of the click and requires it to leave, toast and stage the take under an injected `sendAudio` fault. Both fail on the old build (364 to 480 ms; no staged take).
- **Revert:** `git revert b1fefba8`.

## 2026-10-10. A first visit downloads a third less JavaScript (e47ecc85..c457621b)

- **For the user:** a fresh browser or a new desktop install fetches 524 KB of script instead of 759 KB before the conversation list can paint. Settings, Scheduled, Details, a person, Contacts, search, new message, forward and the command palette load as their own small files, fetched quietly a few seconds after the list appears, so their first open still shows at once.
- **Metric 1d (first-visit JS, brotli):** fixture export 739 KB became 505 KB (-32%). On the wire, production's entry is 759 KB and the preview's three scripts total 524 KB. Raw JS went from 3,712 KB to 2,477 KB, and the export ships 2 font files instead of 20. Five changes, each measured alone: Ionicons only (-101 KB), Metro tree shaking (-65 KB), a gesture-handler patch that lets Reanimated tree-shake (-27 KB), deferred surfaces (-37 KB), the dev-only UI gallery deferred (-4 KB). See H11 to H15.
- **Metric 1a (first-visit list, production data):** 4 interleaved rounds of 5 against production at ee03a642, read-only. Pooled p50 540 to 500 ms, p75 668 to 603 ms, P(preview faster) 0.68. Return visit p50 169 to 150 ms, p75 224 to 215 ms, P 0.73. The target of 450 KB is not met yet.
- **Ratchet:** `scripts/bundle-size.ratchet.ts` sums the brotli size of every `<script src>` in the fixture export and fails above 520,000 bytes. `validate-imsg.yml` builds the fixture export, then runs it. It fails on the origin/main build (739,034) and on the build before deferred surfaces (546,111).
- **Revert:** `git revert c457621b 244fa9cf 8f2e5a04 f636534c ca200280 e47ecc85`, newest first. H13 also needs `bun install` in `apps/imsg/client` to drop the patch.

## 2026-10-11. A Convex timeout no longer crashes the app (d2110009, c0fcae1b)

- **For the user:** when the conversation list or a thread fails to load on the server (the "too many system operations" timeout seen on 2026-10-09), Comma keeps the list and the open conversation on screen, shows "Couldn't refresh. Retrying…", and recovers on its own. Before, one failed page put the whole app on "Something went wrong", and reloading from there lost the open conversation.
- **Ratchet:** `e2e/fixture/query-failure.playwright.ts` fails a list page and a thread page and requires no crash screen, the same row still selected, and recovery. `retrying-query.test.tsx` covers the retry backoff.
- **Revert:** `git revert c0fcae1b d2110009`.

## 2026-10-11. Details opens with its people already there (eb50009b)

- **For the user:** ⌘I shows the conversation's name, people and actions at once instead of a blank pane while the Mac mini answers. On the fixture, ⌘I to content went from 157 to 170 ms to 87 to 103 ms.
- **Ratchet:** `ratchet.playwright.ts` holds chatInfo and requires Details to show the person.
- **Revert:** `git revert eb50009b`.

## 2026-10-11. A suggested reaction shows the moment you confirm it (93a7394d)

- **For the user:** confirming a suggested reaction (React 👍) puts it on the message at once instead of after the Mac mini answers, about 230 ms sooner on the fixture. A failure takes it back with a toast.
- **Ratchet:** `ratchet.playwright.ts` requires the badge within 50 ms of confirming.
- **Revert:** `git revert 93a7394d`.

## 2026-10-11. Send later clears the composer on the tap (db83320e)

- **For the user:** choosing In 1 hour or In 3 hours empties the composer and confirms at once. If the Mac mini rejects it, the text comes back with the error.
- **Ratchet:** `ratchet.playwright.ts` requires the composer empty within 50 ms and the text restored under an injected schedule fault.
- **Revert:** `git revert db83320e`.

## 2026-10-11. Every command on a listed conversation leaves at once (a6acb099)

- **For the user:** a send, settle, pin, mark read or reaction no longer waits a round trip before it is queued. The sidebar moves on the click when you send.
- **Measured on production data, read-only:** click to the enqueue frame leaving the page, p50, went from 115 to 141 ms to 25 to 29 ms, and the extra `resolveChat` per command is gone.
- **Ratchet:** `convex-commands.test.ts` requires a listed chat to enqueue with no query.
- **Revert:** `git revert a6acb099`.

## 2026-10-11. Long threads scroll and update without redrawing everything (6f1176f2, 21b1009d, 8d0a28b9, ac22fac3)

- **For the user:** scrolling back through a long thread draws only the newly loaded messages, and no longer re-marks the thread read on every page. A new message no longer redraws every bubble. Typing renders the composer once per keystroke instead of twice.
- **Metric 3b (frames.ts, 4x CPU, scroll 200 messages):** long-frame time 552 to 131 ms, frames over 33 ms 5 to 1. Rows rendered per scroll 5,240 to 355. Rows per 20 arrivals 462 to 45. Composer renders per 40 keys 84 to 42.
- **Ratchet:** render-count ceilings in `ratchet.playwright.ts` for older pages, arrivals and typing, plus a check that the message you are reading does not move when an older page lands.
- **Revert:** `git revert ac22fac3 8d0a28b9 21b1009d 6f1176f2`.

## 2026-10-11. The header holds still when fonts arrive late (ff9135a0, dd5b731b)

- **For the user:** on a fresh load where the icon and header fonts arrive after the first frame, the search field no longer slides, "Select a conversation" no longer drops, and the lens tabs no longer widen and push Waiting and All sideways.
- **How:** each icon sits in a box of its own size, and on web the header face falls back to a local semibold sans whose letter widths match Bricolage within 0.6 px. Settled screens are pixel-identical.
- **Metric 3a (fixture, fonts held 700 ms, shifts per load):** 5 to 6 became 1.
- **Ratchet:** `ratchet.playwright.ts` holds the fonts 700 ms and allows at most one header shift. The old build shows 4.
- **Revert:** `git revert dd5b731b ff9135a0`.

## 2026-10-11. A fresh load downloads 444 KB of JavaScript (6695e497, 1a9ca847)

- **For the user:** the conversation list appears sooner on a fresh load. The thread view now loads in its own chunk, which starts downloading at boot, and the phone swipe's gesture library loads only on phones.
- **Metric 1d (first-visit JS, brotli):** 506 KB became 444 KB, which meets the 450 KB target. On production data, first-visit list p75 went from 564 to 523 ms (faster in 4 of 4 rounds), and return-visit list p75 from 195 to 138 ms.
- **Ratchet:** `scripts/bundle-size.ratchet.ts` ceiling is now 458,000 bytes. `e2e/fixture/row-swipe.playwright.ts` swipes a phone row and fails if gesture-handler returns to the entry chunk.
- **Revert:** `git revert 1a9ca847 6695e497`.

## 2026-10-11. Sends from anywhere show at once (15e820de, 43cb3d75, 54970c97, c5e3dee9)

- **For the user:** a voice message, a forward, Send again from the message menu, and a send from ⌘K now show a pending bubble or the Sending ring on the click. A failure reverts with a toast; a failed voice take goes back to the tray.
- **Metric 2 (p75, input to first visible change):** voice 534 to 15 ms, forward 432 to 21 ms, Send again 316 to 15 ms, palette send 299 to 50 ms. Non-optimistic interactions: 73 became 69.
- **Ratchet:** four same-frame tests and four rollback tests in `ratchet.playwright.ts`, each failing on the old build.
- **Revert:** `git revert c5e3dee9 54970c97 43cb3d75 15e820de`.

## 2026-10-11. The phone screen holds still while it loads (e13c9aa9)

- **For the user:** at phone width the list no longer jumps as the app fills in; the hidden Contacts tab was still painting behind Messages.
- **Metric 3a (phone 390, shifts per load):** median 5 became 0.
- **Ratchet:** "the phone screen holds still while it loads" in `ratchet.playwright.ts`.
- **Revert:** `git revert e13c9aa9`.

## 2026-10-11. Section counts keep their place while the list loads (50b3b59a)

- **For the user:** the Today, This week and Older counts no longer nudge their labels as pages arrive on a fresh load.
- **Revert:** `git revert 50b3b59a`.

## 2026-10-11. The conversation list reads less on the server (25414156)

- **For the user:** nothing visible until the Convex functions deploy; then each list page does about 12% fewer database lookups and 59% fewer photo-URL calls.
- **Proof:** `convex/comma/listConversations.reads.test.ts` pins read counts and a hash of the output recorded from the old code.
- **Revert:** `git revert 25414156`, then redeploy Convex.

## 2026-10-11. Smoothness benchmark (96f4679d)

- `e2e/bench/frames.ts` measures frames while scrolling a 200-message thread, while 20 messages arrive, and while typing. Baseline: scroll p95 16.8 ms with 4 frames over 33 ms; typing input-to-paint p95 20 ms.

## 2026-10-10. Settle, read, unread and pin land on the frame you act (4f606d83)

- **For the user:** ⌘E moves the Needs reply count on the frame of the keypress, and the row leaves the lens with the selection. Mark read, mark unread, read on open, pin and unpin change the dot, the Unread count and the pinned order at once. If the Mac mini rejects one, it reverts with the existing toast.
- **Metric 2 (non-optimistic interactions):** 80 became 73. `e2e/bench/optimistic.ts`, fixture with tailnet shaping, 9 interleaved runs, p50/p75: settle 339/344 to 22/23 ms, mark unread 286/299 to 15/15 ms, pin 299/299 to 15/16 ms.
- **Ratchet:** `ratchet.playwright.ts` requires the Needs reply count within 50 ms of ⌘E and the unread label within 50 ms of Mark as unread, and requires a mark read to roll back with a toast under an injected bridge fault.
- **Revert:** `git revert 4f606d83`.

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
