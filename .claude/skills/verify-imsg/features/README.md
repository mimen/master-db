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

- [Send a message](./send-text.md) covers typed sends, the Enter and Send entry points, delivery state, and moving out of Needs reply. Its drive is `drives/send-text.ts`.
- [Receive a message](./receive.md) covers live inbound messages, the sidebar preview, the open thread, peer typing, and mark-read.
- [Settle a conversation](./settle.md) covers settling from the row, the header and the keyboard, and Undo.
- [Send attachments](./attachments.md) covers file drops with a caption, voice memos, and an unknown outcome.
- [Schedule a message](./schedule.md) covers Send later, the date editor, and the Scheduled list.
