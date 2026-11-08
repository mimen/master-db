# Slack sending

In a Slack conversation the composer reads `Message <name>`, Enter sends, and the Slack service chip has nothing to switch to. A send shows its bubble at once and becomes Slack's message. The tray offers Slack's quick emoji, and Milad can keep any number of reactions on one message. Edit and Delete work on his own messages at any age; Delete for Me greys, because Slack has no such thing. A send whose answer from Slack is lost shows "Not sure this went through" and Not delivered, then turns into the real message when the unknown-send check finds it in Slack. It is never posted twice.

## Sub-features

- `slack-composer` shows `Message Sam Lee` and a disabled `Service: Slack` chip.
- `slack-send` lands a typed send as a `D1:<ts>` row with its clientKey, with no `temp-` row left.
- `slack-react` adds two emoji reactions from the tray and removes one, read back as `emoji:` keys.
- `slack-edit-delete` edits a sent message, then deletes it, and the row leaves the thread.
- `slack-unknown` loses one send's answer: the toast and Not delivered show, then the check lands it as one message.

## How to get to it (user POV)

- Seed the fixture's Slack DM, open Sam Lee (the row whose preview reads "Are we still on for the load-in at 4?"), and type in the composer.
- Right-click Sam's message for the tray, and your own for Edit and Delete.

## Driving it with Playwright (desk fixture)

The drive is `apps/imsg/e2e/fixture/slack-send.playwright.ts`. CI runs it with every fixture spec.

- **Seed.** POST `/__fixture/slack` with `{ seed: true }`. The answer carries the DM's `conversationId` for `comma/queries:listMessages` read-backs.
- **Send.** Fill `getByPlaceholder("Message Sam Lee")` and press Enter. Poll `listMessages` until the row's guid matches `D1:<ts>`.
- **React.** Right-click the bubble named `Sam Lee: <text>`. The `Tapbacks` toolbar lists 👍, ❤️, 😂, 🙏, 🔥 and 👀; a chosen one shows as `Remove <emoji>` the next time.
- **Edit and Delete.** Right-click your bubble (`getByTestId("message-bubble")`), choose Edit, wait for `getByPlaceholder("Edit message")` to hold the old text, then fill and press Enter. Delete is the menu item named exactly `Delete`.
- **Unknown.** POST `/__fixture/slack` with `{ loseNextAnswerMs: 2000 }` before sending. The next send's receipt is `unknown` until the timer lands it.

## Gotchas

- The fixture's Slack DM exists only after the seed; a reset removes it, so iMessage drives never see it.
- A 👍 reaction chip's accessible name is `Like`, the tapback it looks like. Other emoji chips are named by the emoji.
- The fixture copies the Slack lane's rules (`e2e/fixture/slack.ts`); `convex/comma/slackLane.test.ts` proves the real lane against a fake Slack Web API.
