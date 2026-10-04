# Native dive and unread counts: imsg phone and desktop, 2026-10-04

This audit covers the two surfaces the [production dive](2026-10-04-production-dive.md) left out: the iOS app in Expo Go and the desktop app (`Comma.app`, the Tauri shell). It also covers unread counts, checked against `chat.db`. The phone ran in the iPhone 17 Pro simulator against the Mini's production Metro server. The desktop app was the installed production `Comma.app`. The [computer-use skill](../../../../../Documents/milad-vault/ClaudeConfig/skills/computer-use/SKILL.md) drove both. One test message went to the user's own line, +1 925-997-6370. Inbound tests were out of scope.

Evidence lives on the laptop in `apps/imsg/artifacts/2026-10-04-native-dive/`, which is gitignored. Paths below are relative to it.

| Path | Contents |
|---|---|
| `phone/` | Simulator screenshots `01` to `19`, `phone-dive.mp4`, and the reviewer's `findings.md` |
| `desktop/` | First desktop run, on the stale shell: screenshots `01` to `24` and `findings.md` |
| `desktop-r2/` | Desktop run on shell `ee1d0c7`, plus real screen captures `30` to `32` |
| `19-token-blip*`, `20-palette*`, `21-verify-round2*` | Production checks for N6, N9, N10 and N11, with their scripts in `scripts/` |
| `unread-compare.json` | Per-conversation unread counts, Convex against `chat.db` |
| `scripts/unread-compare.py` | The comparison. Rerun it with `python3 scripts/unread-compare.py out.json` |

## Fixed, deployed and re-verified in production

| # | Severity | Finding | Evidence | Fix | Re-verified |
|---|---|---|---|---|---|
| N1 | High | No conversation ever showed the unread dot. Since the Convex cutover, `listConversations` returned `unreadCount: 0` for every conversation (a TODO in `convex/comma/queries.ts`). `chat.db` had 175 unread conversations. | Source; `chat.db` query on the Mini: 177 chats with unread inbound messages. | `33d63b7` adds an unread mirror to the bridge. It posts each chat's inbound messages newer than its last read or sent message after every arrival, edit and read-status change, and every two minutes. Convex sums sibling chats and clears conversations read since. A mark-read in Comma clears the count before `chat.db` catches up. `02ca3de` makes it pass the deploy gate, which typechecks against the committed generated API. | `unread-compare.json`: 760 conversations, 175 unread in Convex and 175 in `chat.db`, zero mismatches. The production sidebar shows the dots (`../2026-10-04-production-dive/18-verify-unread/01-sidebar-dots.png`). |
| N2 | Medium | A deep-linked phone thread titled itself with the raw handle (`+19259976370`). A named DM showed no number, so same-name threads looked identical. | `phone/07-self-thread-deeplink.png`, `phone/06-thread-error.png`. | `1ae96be` takes the name from the chat directory and shows the formatted number under it. | `phone/16-header-fixed.png`: "Sprout Imen" over "(925) 997-6370". |
| N3 | Medium | Phone Settings opened as a modal sheet with no visible way to close it. The reviewer could not leave it. | `phone/13-settings.png`, `phone/findings.md` item 7. | `1ae96be` adds a Done button. | `phone/17-settings-done.png`. Expo Go's own developer gear sits over it in the simulator; that gear is Expo Go chrome and does not exist on a phone without the developer menu enabled. |
| N4 | Medium | The desktop app had no native Settings entry, so Cmd+comma did nothing, and no Window menu for Minimize, Zoom or Full Screen. | `desktop/findings.md` items 2 and 3, `desktop/06-cmd-comma.png`. | `ee1d0c7` adds Settings… (Cmd+comma) to the app menu through a new `settings.open` command, a standard Window menu, and renames Close to Close Window. | After activation (N5), the accessibility tree reads: Comma menu "About Comma, Settings…, Services, Hide Comma, Hide Others, Quit Comma"; File "New Message, Close Window"; Window "Minimize, Zoom, Toggle Full Screen". Cmd+comma opens Settings and Escape closes it (`desktop-r2/findings.md`). |
| N5 | Medium | The desktop app ran shell `8385983` from Oct 2, so its findings described stale web code, and its Restart banner failed with "Run bun run deploy:activate": that shell predates the in-app activation commands. | `desktop/10-self-open.png`, `desktop/24-after-restart.png`. | With the user's approval, `bun run deploy:activate`, the documented bootstrap for an installed shell older than activation. | `deploy:status`: shell `ee1d0c7` installed, activation verified. The relaunched window shows no update banners (`desktop-r2/01-initial.png`). Later shells update through the in-app Restart. |
| N6 | Medium | The command palette seemed not to close on Escape or a backdrop click in the desktop app. | `desktop/findings.md` items 6 to 8. | No code change. On current code it closes in Chromium and WebKit (`20-palette.json`, `20-palette-webkit/`). On the live desktop app, real screen captures before Cmd+K and after Escape are byte-identical (`desktop-r2/30-screen.png`, `32-after-esc.png`). The reviewer's window captures went stale and repeated the open palette: four sequential window captures had the same bytes (`desktop-r2/20` to `23`). | `20-palette.json`: opens, Escape closes, backdrop click closes without reaching the list. |
| N7 | Low | The phone filter strip cut "Waiting" off with no scroll cue, and named the queue "Unresponded". | `phone/05-search.png`. | No code change. That strip was removed on Oct 2 (`953df00`); the first phone run was on a stale Expo Go session. | `phone/18-list-current.png`: the current list shows one Needs reply / Waiting / All control. |
| N8 | Low | Phone Settings read "Version local build", because Metro served source without a release SHA. | `phone/13-settings.png`. | `17c68e7` has the `comma:expo` agent export the checkout's SHA and the production environment when it starts, which every deploy does. | `phone/19-settings-version.png`: "Version 17c68e702b14". |
| N9 | Low | Dragging the desktop sidebar divider also selected page text. | `desktop/20-divider-drag.png`. | `48231f9` sets `user-select: none` on the document for the length of a drag. The detail pane overlaps the right half of the 6 px handle, so only its left 3 px take the pointer. | `21-verify-round2.json`: the divider moved 119 px with 0 characters selected, and the body style was restored. |
| N10 | Low | A note-to-self thread showed two or three received copies of each unsent test message: with the outgoing original gone, no echo had anything to match. | `phone/14-after-metro-restart.png`. | `48231f9`: once a thread is a note-to-self, inbound copies of the same text within 10 s collapse to the first. A real chat keeps someone's repeated message. | `21-verify-round2.json`: one copy each of "[comma test ds4k] unsend" and "[comma test 5tfr] unsend". |
| N11 | High | Two failed `/api/convex-token` requests during a load threw the app onto "Something went wrong" with `Unauthorized`. Convex treats a null token as signed out. The desktop app hit this on Reload. | `desktop/22-after-restart.png`; `19-token-blip.json`: with 2 token failures, `crashed: true`, 0 rows. | `eaa5384` retries the token at 250 ms, 750 ms, 2 s and 5 s before giving up. | `19-token-blip-after-fix.json`: 3 failed token requests, no crash, 144 rows. |

## Checked and explained

- **The phone's 404 banners came from a stale Expo Go session, not the app.** The first phone run showed "Uncaught (in promise) Error: 404: 404 Not Found" every 5 seconds and blank threads (`phone/06-thread-error.png`). The device log showed the request repeating at a 5-second interval, and no request in the app's code matches it. After Expo Go was relaunched, the errors stopped and threads loaded. Restarting the Mini's Metro server under an open session did not bring them back (`phone/14-after-metro-restart.png`). The likely cause is a session that outlived several Metro restarts on the Mini, which restarts on every deploy. The fix is the same as for any Expo Go session that has been open for a long time: reload it.
- **Sending from the phone works.** One send, "[comma test phone] hello from the simulator", appeared once within about 1.5 s and showed "Read" within 6 s (`phone/10-sent-immediate.png`, `phone/11-sent-after-6s.png`).
- **The keyboard keeps the last message visible** above the composer (`phone/12-keyboard.png`).

## Round 3

| # | Severity | Finding | Fix | Re-verified |
|---|---|---|---|---|
| N12 | Medium | The command palette exposed only its backdrop's "Close" button to assistive tech; its input and commands were invisible. | `2249b10` makes it a labelled modal dialog with a combobox controlling a listbox of options, marks the current option selected, and hides its icons and Enter hint. | `22-a11y-production-aria.txt`: `dialog "Command palette"` > `combobox "Search or jump to"` > `listbox "Results"` with 22 named options, one selected. |
| N13 | Low | The sidebar resize handle hung 3 px past an overflow-clipped pane, so only its left half took the pointer. | `2249b10` moves it inside the edge. | `22-a11y-production.json`: all 6 px reachable; a drag from its centre moved it 97 px. |

## Not evaluated

- Long-press menus and history scrolling on the phone: the simulator input path could not produce a long press or a scroll gesture.
- The open menus on the desktop: macOS refused window captures while a menu was open. The menu contents were read from the accessibility tree instead.
- Inbound messages, push notifications, and a physical iPhone.
