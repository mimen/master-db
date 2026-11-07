# Reactions

A reaction is generic data: a key (an iMessage tapback name such as `love`, or an emoji tapback's emoji), an optional emoji, and its sender. Convex stores each sender's newest state per message and key in `comma_reactions`; ingest turns an iMessage tapback into that state instead of a message row. The tray offers the route's reaction set from its platform profile.

## Sub-features

- `reactions-react` lands my Like on the stored row as `key: "like"`.
- `reactions-change` turns Laugh on and Like off; the tray toggles each tapback, so a change is two picks.
- `reactions-remove` clears my last reaction.
- `reactions-peer` shows a peer's reactions, and a peer's removal hides only that reaction.

## How to get to it (user POV)

Open Alex Rivera and right-click the inbound bubble to open the tray.

## Driving it with Playwright (desk fixture)

The drive is `drives/reactions.ts`. It records every `react` enqueue and reads reactions back through `comma/queries:listMessages`.

- **Peer love.** Before opening the thread, POST `/__fixture/tapback` with `{ chatGuid, targetGuid: "needs-1", reaction: "love", handle }`. The `Love` chip shows on my message.
- **React, change, remove.** Pick `Like`, then `Laugh`, then `Remove Like`, then `Remove Laugh`. Chips follow, and the stored row shows my keys at each step.
- **Peer.** POST `/__fixture/tapback` with `reaction: "emphasize"`, then `"-love"`. The `Emphasize` chip shows and `Love` goes.

## Gotchas

- The fixture clock is pinned, so every reaction event shares one timestamp. The fixture folds tapbacks in arrival order, which is what a later-wins tie gives in Convex.
- Chips are labelled by glyph (`Love`, `Like`, `Laugh`, `Emphasize`), not by message, so a drive tells messages apart through the stored rows.
- The agent pane in the fixture does not read `agentContext`. Reactions in agent and Today context are covered by `convex/comma/agentContext.test.ts`, `apps/imsg/server/agent/context.test.ts` and `apps/imsg/server/today/prompt.test.ts`.
