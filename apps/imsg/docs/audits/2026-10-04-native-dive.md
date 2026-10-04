# Native dive and unread counts: imsg phone and desktop, 2026-10-04

This audit covers the two surfaces the [production dive](2026-10-04-production-dive.md) left out: the iOS app in Expo Go and the desktop app (`Comma.app`, the Tauri shell). It also covers unread counts, checked against `chat.db`. The phone ran in the iPhone 17 Pro simulator against the Mini's production Metro server. The desktop app was the installed production `Comma.app`. The [computer-use skill](../../../../../Documents/milad-vault/ClaudeConfig/skills/computer-use/SKILL.md) drove both. One test message went to the user's own line, +1 925-997-6370. Inbound tests were out of scope.

Evidence lives on the laptop in `apps/imsg/artifacts/2026-10-04-native-dive/`, which is gitignored. Paths below are relative to it.

| Path | Contents |
|---|---|
| `phone/` | Simulator screenshots `01` to `17`, `phone-dive.mp4`, and the reviewer's `findings.md` |
| `desktop/` | Window screenshots `01` to `21` and the reviewer's `findings.md` |
| `unread-compare.json` | Per-conversation unread counts, Convex against `chat.db` |
| `scripts/unread-compare.py` | The comparison. Rerun it with `python3 scripts/unread-compare.py out.json` |

## Fixed and deployed

N1 to N3 are re-verified in production. N4 is deployed but not yet running: see its row.

| # | Severity | Finding | Evidence | Fix | Re-verified |
|---|---|---|---|---|---|
| N1 | High | No conversation ever showed the unread dot. Since the Convex cutover, `listConversations` returned `unreadCount: 0` for every conversation (a TODO in `convex/comma/queries.ts`). `chat.db` had 175 unread conversations. | Source; `chat.db` query on the Mini: 177 chats with unread inbound messages. | `33d63b7` adds an unread mirror to the bridge. It posts each chat's inbound messages newer than its last read or sent message after every arrival, edit and read-status change, and every two minutes. Convex sums sibling chats and clears conversations read since. A mark-read in Comma clears the count before `chat.db` catches up. `02ca3de` makes it pass the deploy gate, which typechecks against the committed generated API. | `unread-compare.json`: 760 conversations, 175 unread in Convex and 175 in `chat.db`, zero mismatches. The production sidebar shows the dots (`../2026-10-04-production-dive/18-verify-unread/01-sidebar-dots.png`). |
| N2 | Medium | A deep-linked phone thread titled itself with the raw handle (`+19259976370`). A named DM showed no number, so same-name threads looked identical. | `phone/07-self-thread-deeplink.png`, `phone/06-thread-error.png`. | `1ae96be` takes the name from the chat directory and shows the formatted number under it. | `phone/16-header-fixed.png`: "Sprout Imen" over "(925) 997-6370". |
| N3 | Medium | Phone Settings opened as a modal sheet with no visible way to close it. The reviewer could not leave it. | `phone/13-settings.png`, `phone/findings.md` item 7. | `1ae96be` adds a Done button. | `phone/17-settings-done.png`. Expo Go's own developer gear sits over it in the simulator; that gear is Expo Go chrome and does not exist on a phone without the developer menu enabled. |
| N4 | Medium | The desktop app had no native Settings entry, so Cmd+comma did nothing, and no Window menu for Minimize, Zoom or Full Screen. | `desktop/findings.md` items 2 and 3, `desktop/06-cmd-comma.png`. | `ee1d0c7` adds Settings… (Cmd+comma) to the app menu through a new `settings.open` command, a standard Window menu, and renames Close to Close Window. | Not yet re-verified. The Mini built and published shell `ee1d0c7`, but the installed `Comma.app` is still shell `8385983` and only picks up a new shell when the user clicks Restart. After Restart, Comma ▸ Settings… and Cmd+comma should open Settings, and the Window menu should appear. |

## Checked and explained

- **The phone's 404 banners came from a stale Expo Go session, not the app.** The first phone run showed "Uncaught (in promise) Error: 404: 404 Not Found" every 5 seconds and blank threads (`phone/06-thread-error.png`). The device log showed the request repeating at a 5-second interval, and no request in the app's code matches it. After Expo Go was relaunched, the errors stopped and threads loaded. Restarting the Mini's Metro server under an open session did not bring them back (`phone/14-after-metro-restart.png`). The likely cause is a session that outlived several Metro restarts on the Mini, which restarts on every deploy. The fix is the same as for any Expo Go session that has been open for a long time: reload it.
- **Sending from the phone works.** One send, "[comma test phone] hello from the simulator", appeared once within about 1.5 s and showed "Read" within 6 s (`phone/10-sent-immediate.png`, `phone/11-sent-after-6s.png`).
- **The keyboard keeps the last message visible** above the composer (`phone/12-keyboard.png`).

## Remaining findings, with proposed fixes

| # | Severity | Finding | Evidence | Proposed fix |
|---|---|---|---|---|
| N5 | Medium | The desktop app runs an old shell. It shows "Web update ready" and "Shell update ready" banners over the thread header, so many desktop findings may describe stale web code (the stacked filter chips, the triage footer and the missing handle labels are all older UI). | `desktop/10-self-open.png`. | Click Restart in the desktop app. That is the user's call; the agent does not restart the running production app. Then rerun the desktop dive. |
| N6 | Medium | In the desktop app, the command palette did not always close on Escape, and clicks reached the window behind it. | `desktop/findings.md` items 6 to 8, `desktop/08-cmd-k.png`. | Re-check after N5; if it reproduces on current code, give the palette a modal backdrop that takes clicks and closes on Escape from any focus. |
| N7 | Low | The phone filter strip cuts "Waiting" off at the right edge with no scroll cue. | `phone/05-search.png`. | Fade the trailing edge, or use the desktop's three-segment control on the phone. |
| N8 | Low | Phone Settings reads "Version local build" in production Expo Go, because Metro serves source without a release SHA. | `phone/13-settings.png`. | Have the `comma:expo` LaunchAgent export `EXPO_PUBLIC_IMSG_WEB_SHA` from the Mini's checkout. |
| N9 | Low | Dragging the desktop sidebar divider also selects page text. | `desktop/20-divider-drag.png`. | Set `user-select: none` on the document while a divider drag is active. |
| N10 | Low | Note-to-self threads show the received copy several times for sends from before the echo fix (three copies each of "5tfr" and "ds4k"). | `phone/14-after-metro-restart.png`. | BlueBubbles stored two or three inbound rows per send for those runs; the client filter hides one echo per outgoing message. Hide every inbound copy that matches, or leave the history as is. |

## Not evaluated

- Long-press menus and history scrolling on the phone: the simulator input path could not produce a long press or a scroll gesture.
- The open menus on the desktop: macOS refused window captures while a menu was open. The menu contents were read from the accessibility tree instead.
- Inbound messages, push notifications, and a physical iPhone.
