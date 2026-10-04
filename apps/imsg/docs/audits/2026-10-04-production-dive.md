# Production dive: imsg web app, 2026-10-04

Every finding below is fixed, deployed and re-verified in production.

This audit drove the production web app at `https://milads-mac-mini.taild31e9a.ts.net:8447` in headless Chromium. It recorded video, Playwright traces and screenshots, and checked each result against `chat.db` on the Mini and the Convex deployment `shiny-gerbil-853`. Real messages went only to the user's own line, +1 925-997-6370, each prefixed `[comma test …]`. Inbound tests were out of scope.

Evidence lives on the laptop in [`apps/imsg/artifacts/2026-10-04-production-dive/`](../../artifacts/README.md), which is gitignored. Paths below are relative to it.

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
| F6 | Medium | A fired scheduled message stayed listed as pending for up to 5 minutes, the mirror's poll interval. | `listScheduled` showed `pending` after the message was delivered at 06:01. | `35b1ad0` refreshes the scheduled mirror whenever an outgoing message lands. | A message scheduled to the self line turned `complete` in Convex 1.9 s after its send time, and the Scheduled view shows it as Sent (`17-verify-scheduled.json`, `17-verify-scheduled/03-scheduled-view-after.png`). |
| F7 | Low | Tapback buttons had no role, label or state. A screen reader read only the emoji. | `08-feel-desktop/findings.json` lists `tapbackLabels: ["(none)" ×6]`. | `dbcda95` adds a role, a label ("Love", "Remove Love", …) and a selected state. | `10-verify-round2/results.json`: `tapbackLabels: [Love, Like, Dislike, Laugh, Emphasize, Question]`. |

## Round 2: medium and low findings, fixed, deployed and re-verified in production

Production ran `d2a87ec0` for every check below.

| # | Severity | Finding | Evidence | Fix | Re-verified |
|---|---|---|---|---|---|
| R1 | Medium | A cold load or a deep link showed skeleton rows and the raw GUID header for about 1.3 s. | `05-coldlink/log.txt`: `rows=0@110ms header=guid@110ms … rows=24@1296ms`. | `6c4cee8` persists the last full conversation list to `localStorage` and paints it until the live query answers. It also names a deep-linked chat by its formatted handle, or "Group conversation", never the GUID. | With every Convex request blocked, 140 rows painted from the snapshot in 726 ms and the header showed no GUID (`12-verify-mediums.json`, `12-verify-mediums-cold/03-cold-from-snapshot.png`). |
| R2 | Medium | Eight DM names collided across 17 conversations, with no way to tell them apart. | `listConversations`: `8 names covering 17 conversations`. | `a2df13e` adds the handle beside the name on rows whose name repeats across DMs, and to every DM header subtitle. | The three "Sprout Imen" rows each show their own number, and the header reads "(925) 997-6370" (`12-verify-mediums-names/01-same-name-rows.png`, `02-header-handle.png`). Merging one person's handles into a single conversation remains a possible later change. |
| R3 | Medium | Recent image attachments rendered "Media pending or unavailable" because Messages never downloaded them. | `chat.db` rows with `transfer_state=0` and no file. | `10a94dd` queues every visible attachment for mirroring, including off-disk ones, so BlueBubbles fetches the file when it can. `dc9f59b` labels the rest "Not downloaded on the Mac". | 103 of the 115 recent images are now mirrored. The other 12 return BlueBubbles' `Attachment does not exist in disk!`, and a forced download hangs, so they cannot be fetched from the Mac. Kat Pulgarin's thread shows the new label (`15-verify-undownloaded/01-undownloaded-label.png`, `15-verify-undownloaded.json`: `notDownloadedLabels: 1, oldPendingLabels: 0`). |
| R4 | Medium | The context menu could not be opened from the keyboard, and Tab stopped on three buttons per sidebar row. | `08-feel-desktop/findings.json`: `keyboardContextMenu: false`. | `228f98f` makes bubbles and rows focusable and opens their menu on `ContextMenu` or `Shift+F10`. A row's Settle and More buttons leave the tab order. | Zero Settle or More stops in the first 12 tabs. A focused bubble opens the message menu on both keys (`12-verify-mediums.json`, `13-keyboard-probe/log.txt`). |
| R5 | Low | Edit and Unsend were missing from the menu for the 3 to 5 s a send took to confirm. | `03-actions/02-menu.png`. | `5439701` shows both disabled, as "Edit · available once sent" and "Unsend · available once sent". | `14-verify-lows/02-pending-menu.png`, `14-verify-lows.json`: `pendingEditDisabled: true`. |
| R6 | Low | The suggestion shelf flashed three empty pills on every thread open. | `06-verify/04-offline-bar.png`. | `184b19a` holds the placeholder back for 600 ms and renders nothing until then. | Sampled every 100 ms for 3 s after opening a thread: the placeholder never appeared (`14-verify-lows.json`: `suggestionSkeletonVisibleAtMs: []`). |
| R7 | Low | A note-to-self thread showed every message twice. | `03-actions/01-duplicate-check.png`. | `0111be8` hides the inbound copy of an outgoing message within 10 s, only in threads where nearly every outgoing message has such an echo. | One copy of each test message, on the sender's side (`14-verify-lows/01-self-thread-once.png`). |
| R8 | Low | The verification skill captured no video. | Skill source. | `d2a87ec` records video, a trace and screenshots on every drive, and keeps `video.webm` and `trace.zip` with the evidence. | A passing `send-text` drive kept a 3.4 s `video.webm` and a trace (`16-skill-video/`). |

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
