# Reactions

A reaction is generic data: a key (an iMessage tapback name such as `love`, or `emoji:` and an emoji tapback's emoji), an optional emoji, and its sender. A sender has one reaction per message: a new one replaces theirs. Convex stores each sender's newest state per message and key in `comma_reactions`; ingest turns an iMessage tapback into that state instead of a message row. The tray offers the route's reaction set from its platform profile.

## Sub-features

- `reactions-react` lands my Like on the stored row as `key: "like"`.
- `reactions-change` picks Laugh over my Like, and Laugh replaces it.
- `reactions-remove` clears my last reaction.
- `reactions-peer` shows a peer's reaction replacing their earlier one, and their removal clearing it.

## How to get to it (user POV)

Open Alex Rivera and right-click the inbound bubble to open the tray.

## Driving it with Playwright (desk fixture)

The drive is `apps/imsg/e2e/fixture/golden-reactions.playwright.ts`. It records every `react` enqueue and reads reactions back through `comma/queries:listMessages`.

- **Peer love.** Before opening the thread, POST `/__fixture/tapback` with `{ chatGuid, targetGuid: "needs-1", reaction: "love", handle }`. The `Love` chip shows on my message.
- **React, change, remove.** Pick `Like`, then `Laugh`, then `Remove Laugh`. Chips follow, and the stored row shows my keys at each step.
- **Peer.** POST `/__fixture/tapback` with `reaction: "emphasize"`: it replaces Alex's `Love`. Then `"-emphasize"` clears it.

## Gotchas

- The fixture clock is pinned, so every reaction event shares one timestamp. The fixture folds tapbacks in arrival order, which is what a later-wins tie gives in Convex.
- Chips are labelled by glyph (`Love`, `Like`, `Laugh`, `Emphasize`), not by message, so a drive tells messages apart through the stored rows.
- The agent pane in the fixture does not read `agentContext`. Reactions in agent and Today context are covered by `convex/comma/agentContext.test.ts`, `apps/imsg/server/agent/context.test.ts` and `apps/imsg/server/today/prompt.test.ts`.

## Emoji reactions

The tray's last button, `More reactions`, opens a `dialog` named `Emoji reactions`: quick emoji buttons named by their emoji, and an `Any emoji` field that sends the first emoji typed into it. My emoji reaction shows in the tray as `Remove <emoji>`. The fixture's fake Mac can send emoji; `POST /__fixture/emoji-reactions {"enabled": false}` makes it report what BlueBubbles 1.9.12 does, and a press on `More reactions` then shows "The Mac's BlueBubbles can't send emoji reactions yet" instead of the picker (`null` restores it). A peer's emoji tapback is `POST /__fixture/tapback` with the emoji as `reaction`; the fixture writes it as a 2006 row with Messages' "Reacted … to" text, the way ingest receives it. react-native-web drops `aria-disabled` on a tray button, so a drive checks the reason, not the attribute.
