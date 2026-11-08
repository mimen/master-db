# imsg verification map

This directory is the maintained source for verifying imsg's user-facing behavior. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- The fixture was started by `.claude/skills/verify-imsg/scripts/launch.sh` and answers at `http://127.0.0.1:8399`.
- `.claude/skills/verify-imsg/scripts/doctor.sh` exits 0 and reports a build from the current HEAD.
- Each drive starts from the reset fixture world, which the `desk` fixture provides automatically.
- Never drive an instance this skill did not start.

## Driving conventions

- Run every drive through `scripts/drive.sh <drive.ts> <feature-id>`. Drives import `{ test, expect }` from `"../fixtures/desk"`.
- Prefer test IDs, ARIA roles and accessible names, and the composer placeholder `iMessage`, over CSS or DOM position.
- Click and type as a user does. Enqueueing commands directly through `/__fixture/convex` is allowed only to read state back, or to simulate the other party.
- Simulate the other person with `desk.receive(chatGuid, text)` and `desk.setTyping(chatGuid, on)`.
- The `desk` fixture fails any drive in which the client calls a Mini route other than the session or release routes.

## Proof and skip reporting

- Capture a screenshot before acting, and another after the UI settles.
- Write an ARIA snapshot of the changed region to `aria.txt`.
- Record the side effect from a second view: the Convex command the client enqueued, plus the stored row read back through a Convex query.
- Evidence lives in `<state dir>/evidence/<feature-id>/` (path printed by `drive.sh`) and survives cleanup.
- Report an unreachable path with the attempted step and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections, in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with Playwright (desk fixture)`, and `Gotchas`.

## Features

- [Send a message](./send-text.md) covers typed sends, the Enter and Send entry points, delivery state, a burst of sends, and moving out of Needs you. Its drives are `apps/imsg/e2e/fixture/golden-send-text.playwright.ts` and `apps/imsg/e2e/fixture/golden-send-burst.playwright.ts`.
- [Receive a message](./receive.md) covers live inbound messages, the sidebar preview, the open thread, peer typing, and mark-read.
- [Settle a conversation](./settle.md) covers settling from the row, the header and the keyboard, and Undo.
- [Send attachments](./attachments.md) covers file drops with a caption, voice memos, and an unknown outcome.
- [Schedule a message](./schedule.md) covers Send later, the date editor, and the Scheduled list.
- [Slack sending](./slack-send.md) covers the Slack composer, send, many reactions, edit, Delete, and a lost answer the unknown-send check lands. Its drive is `apps/imsg/e2e/fixture/slack-send.playwright.ts`.
- [Agent pane](./agent-pane.md) covers ⌘J, asking, the work log, question cards, composer and pane drafts, New chat, and the state strip. Its drive is `drives/agent-pane.ts`.
- [Agent chats in the conversation list](./agent-list.md) covers the avatar badges, Needs you, the Agents tab, settle, the pane opening itself, toasts and the ⌘K group. Its drive is `drives/agent-list.ts`.
- [Conversation identity](./conversation-identity.md) covers `/c/<id>` URLs, conversation ids in commands and queries, the `/chat/` redirect, and a group's CRM by id. Its drive is `apps/imsg/e2e/fixture/golden-conversation-identity.playwright.ts`.
- [Reactions](./reactions.md) covers react, change and remove through the tray, and a peer's reactions coming and going. Its drive is `apps/imsg/e2e/fixture/golden-reactions.playwright.ts`.
- [Emoji reactions](./reactions.md#emoji-reactions) covers sending an emoji from the picker, changing it by typing one, removing it from the tray, a peer's emoji reaction, the greyed picker when the Mac can't send emoji, and the phone's touch tray. Its drive is `apps/imsg/e2e/fixture/golden-emoji-reactions.playwright.ts`.
- [Platform profile](./platform-profile.md) covers greyed reactions, Reply, Edit and Undo send on SMS, the tray's keyboard pick, Convex refusing an unsupported command, and an unchanged iMessage thread. Its drive is `apps/imsg/e2e/fixture/golden-platform-profile.playwright.ts`.
- [Pending send](./pending-send.md) covers Waiting to send with the Mini away or the browser offline, Cancel, sending on reconnect, Not sent after the deadline, and Retry. Its drive is `apps/imsg/e2e/fixture/golden-pending-send.playwright.ts`.
