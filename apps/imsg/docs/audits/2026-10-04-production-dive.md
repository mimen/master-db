# Production dive: imsg web app, 2026-10-04

This audit drove the production web app at `https://milads-mac-mini.taild31e9a.ts.net:8447` in headless Chromium. It recorded video, Playwright traces and screenshots, and checked each result against `chat.db` on the Mini and the Convex deployment `shiny-gerbil-853`. Real messages went only to the user's own line, +1 925-997-6370, each prefixed `[comma test …]`. Inbound tests were out of scope.

Evidence lives on the laptop in `/tmp/comma-dive/`:

| Path | Contents |
|---|---|
| `report/*.mp4` | Videos of the send, action, schedule/offline and verification runs |
| `<run>/` | Per-run `log.txt`, screenshots, `trace.zip` and `observed.json` (Mini routes called, Convex functions called, console errors) |
| `scripts/` | The dive scripts. Rerun any of them from inside `apps/imsg` with `CHROME=<playwright chromium> node <script>` |

Severity scale:

- **Critical.** Breaks correctness of sent or received messages.
- **High.** A core action visibly misbehaves, or an outage goes unreported.
- **Medium.** Misleading or degraded but recoverable.
- **Low.** Polish or accessibility.

## Fixed, deployed and re-verified in production

| # | Severity | Finding | Evidence | Fix | Re-verified |
|---|---|---|---|---|---|
| F1 | Critical | Every sent message rendered two to four times. BlueBubbles echoes omit `tempGuid`, so the real row arrived without the `clientKey`. The Convex temp row was never retired, and the client's local bubble also survived. | `02-sends/send-plain-enter.png` and `send-burst.png` show four and three copies. The log reads `plain-enter … copies 4`. Convex rows `temp-temp-…` coexist with real GUIDs. | `de9a3e4` retires the temp row when the bridge confirms the send. `436faf3` drops a temp row once the local bubble has settled to the real GUID. Both carry regression tests. | `06-verify/results.json` reads `ownCopiesAfterEcho: 1`. `03-actions` shows one copy after 8 s. |
| F2 | High | Unsend went through in iMessage, but the bubble stayed on screen. BlueBubbles reports an unsend as an edit to empty text and never sets `dateRetracted`. | `03-actions/06-unsent.png` still shows the message after 20 s. BlueBubbles returned `text=None, dateEdited=…, dateRetracted=None`. | `154913a`: an emptied edit with no attachments maps to `retracted`. Regression test in `server/map.test.ts`. | `unsendRemovedMs: 1059`, `ownCopiesAfterUnsendSettles: 0`. |
| F3 | High | The offline bar could never appear. After the Convex cutover, `useChats` hard-coded `error = null`. Once wired up, the bar still lagged about 60 s behind the network drop. | `04-schedule-offline/04-offline.png` shows no bar while offline. `07-offline-probe/log.txt`: `offline bar after 60260ms`. | `8525a23` wires the bar to the Convex connection state and removes a Retry link that did nothing. `e179833` leads with the browser's `online`/`offline` events. | `offlineBarMs: 81`, `offlineBarClearsMs: 91`. Screenshot: `06-verify/04-offline-bar.png`. |
| F4 | High | A sent link preview was a blank card. The card renders outside the blue bubble, but used white text on a translucent white fill. | `09-linkcard/01-sent-card.png` shows a large empty gap on the sender's side. Computed `color rgb(255,255,255)` on `rgba(255,255,255,0.14)`. | `6f316a7`: neutral card colors for both directions, aligned to the sender's side. | `10-verify-round2/results.json`: title `rgb(0,0,0)` on `rgb(240,240,243)`. `11-preview-image/01-preview-after-wait.png` shows the image, title and description. |
| F5 | Medium | A chat opened by URL or from search showed its raw GUID (`iMessage;-;+19259976370`) as its title. The workspace looked the chat up only in the queue-filtered list. | `02-sends/01-self-thread.png`. | `bfe8d65` resolves the chat from the unfiltered list. | `06-verify` `header: true`. `03-actions` header reads `Sprout Imen`. |
| F6 | Medium | A fired scheduled message stayed listed as pending for up to 5 minutes, the mirror's poll interval. | `listScheduled` showed `pending` after the message was delivered at 06:01. | `35b1ad0` refreshes the scheduled mirror whenever an outgoing message lands. | Deployed. The next fired schedule clears within one live-event cycle. Exercised by the unit suite, not by a second timed production run. |
| F7 | Low | Tapback buttons had no role, label or state. A screen reader read only the emoji. | `08-feel-desktop/findings.json` lists `tapbackLabels: ["(none)" ×6]`. | `dbcda95` adds a role, a label ("Love", "Remove Love", …) and a selected state. | `10-verify-round2/results.json`: `tapbackLabels: [Love, Like, Dislike, Laugh, Emphasize, Question]`. |

## Remaining findings, with proposed fixes

| # | Severity | Finding | Evidence | Proposed fix |
|---|---|---|---|---|
| R1 | Medium | A cold load or a deep link shows skeleton rows and the raw GUID header for about 1.3 s, then the real list. A reload takes about 0.6 s. | `05-coldlink/log.txt`: `rows=0@110ms header=guid@110ms … rows=24@1296ms header=name@1296ms`. | Persist the last conversation list (names, GUIDs, previews) to `localStorage` and render it on first paint, replaced by the live query. Seed the header from the persisted list, or from a `name` URL parameter on deep links, so it never shows a GUID. |
| R2 | Medium | Eight DM names collide across 17 conversations ("Sprout Imen" ×3, "Alex Barrera" ×2, …). Rows and headers give no way to tell them apart, and the one person's phone, second number and Gmail split into separate threads. | Query of `listConversations`: `8 names covering 17 conversations`. `02a-navigate/00-search-self.png`. | Short term: when a display name repeats, add the handle to the row subtitle and header (for example "Sprout Imen · +1 925-375-9404"). Long term: merge one person's per-handle conversations in the conversation key, the way SMS and iMessage siblings already merge. |
| R3 | Medium | Six recent image attachments (in 3 chats) render "Media pending or unavailable". Their `transfer_state` is 0 and the file is not on disk on the Mini, so Messages never downloaded them. | Attachment scan: `114 with media, 6 without`. `chat.db` rows `transfer_state=0`, `filename IS NULL`. Screenshot `02a-navigate/01-self-thread.png`. | Have the bridge ask BlueBubbles to download attachments with `transfer_state = 0`, then upload them once on disk. In the client, label these "Not downloaded on the Mac" rather than "pending". |
| R4 | Medium | The context menu cannot be opened from the keyboard, and Tab walks every sidebar row's Settle and More buttons (three stops per row) before reaching the thread. | `08-feel-desktop/findings.json`: `keyboardContextMenu: false`. The `tabOrder` list stays inside the sidebar. | Make message bubbles focusable, and open the action sheet on `ContextMenu`/`Shift+F10` and `Enter`. Give the sidebar a single tab stop with arrow-key row navigation (roving `tabindex`). |
| R5 | Low | Edit and Unsend appear in the menu only once a send is confirmed, which takes 3 to 5 s. Before that, the menu shows only Reply/Copy/Forward, with no hint why. | `03-actions/02-menu.png`. `06-verify` needed retries before Unsend was offered. | Show the actions disabled with "Available once sent", or queue the edit or unsend against the pending send. |
| R6 | Low | The suggestion shelf shows three empty grey pills while it loads, on every thread open. | `06-verify/04-offline-bar.png` and `08-feel-phone/02-phone-thread.png`. | Render nothing until suggestions arrive, or a single compact shimmer that does not reserve three pill widths. |
| R7 | Low | Self-chat threads show every message twice (sent plus the received echo). That is how iMessage reports a note to self, but it reads as a bug. | `03-actions/01-duplicate-check.png`. | For a DM whose participant is one of the user's own handles, hide the inbound copy that matches an outgoing message within a few seconds. |
| R8 | Low | The verification skill (`.claude/skills/verify-imsg`) captures screenshots and an ARIA snapshot, but no video. | Skill source. | Add `recordVideo` and tracing to the drive config, and keep the `.webm` with the evidence, the way the dive scripts in `scripts/lib.mjs` do. |

## Checked and fine

- **History completeness.** Message counts match `chat.db` (within 5 %) for all 25 sampled DMs. The 20-message thread that would not scroll further has exactly 20 messages.
- **Sends.**
  - A bubble appears in about 0.1 s and is confirmed in 3 to 5 s.
  - Long text, emoji, CJK, curly quotes, links, three sends in a quick burst, and Shift+Enter multiline all work.
  - Replies, reactions, edits, photo plus caption, sending while offline (confirmed 3.3 s after reconnect), and scheduled send all work. The scheduled send fired at the chosen minute, 06:01.
- **Load and navigation.**

  | Measure | Time |
  |---|---|
  | Cold load to first row | 1.1–1.7 s |
  | Full sidebar (144 rows) | 2.1 s |
  | Thread open | about 0.2 s |
  | Tab switch | about 0.5–0.6 s |
  | Search | 1.3 s |

  Phone width has no horizontal overflow and has a back button.
- **Boundary.** The client called only `/api/convex-token` and `/api/deploy/status` on the Mini, with zero console errors in every run (`observed.json`).
