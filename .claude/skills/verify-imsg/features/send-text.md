# Send a message

A user types in the composer of an open conversation and sends. The message appears in the thread immediately, keeps the same bubble from pending to delivered without flicker, shows `Sent` once confirmed, and the conversation leaves Needs reply for Waiting.

## Sub-features

- `send-enter` sends with the Enter key.
- `send-button` sends with the Send button.
- `send-state` shows a pending bubble that settles to `Sent` in place, without remounting.
- `send-triage` moves the conversation from Needs reply to Waiting.
- `send-failure` marks the bubble Not Delivered and raises one toast when the send fails.

## How to get to it (user POV)

- Open a conversation from the sidebar, type in the `iMessage` composer and press Enter.
- Type in the composer and choose the `Send` button.

## Driving it with Playwright (desk fixture)

Preconditions:

- Fixture healthy; doctor passes.
- Alex Rivera (`desk.chats.needs`) is in Needs reply, with an inbound last message.

- **Open thread.** Choose the Alex Rivera row. `page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).click()`. `getByTestId("thread-view")` becomes visible.
- **Send with Enter.** `getByPlaceholder("iMessage").fill(text)`, then `.press("Enter")`. Exactly one bubble with `text` appears in the thread view, and the composer empties.
- **Send with the button.** Fill the composer, then `getByRole("button", { name: "Send", exact: true }).click()`. The result is the same as Enter.
- **Confirm the side effect.** Capture `/__fixture/convex` request bodies where `name === "comma/outbox:enqueue"` and `payload.kind === "send"`, and expect one with `text`. Then poll `comma/queries:listMessages` for `{ conversationId: desk.chats.needs }` until a row with `text` has a guid starting `out-` and `isFromMe: true`.
- **Settled state.** Poll the bubble's computed opacity until it is 1. The bubble's footer reads `Sent`, and the sidebar Needs reply count drops by one while Waiting rises by one.
- **Failure path.** Before sending, `POST /__fixture/fault {"method":"sendText","error":"offline"}`. The bubble shows Not Delivered and one toast appears. Clear the fault with `{"method":null}`.
- **Proof.** Run `drives/send-text.ts`. It writes `1-before.png`, `2-after.png`, `aria.txt` and `side-effects.json`.

## Gotchas

- The bubble fades in. A screenshot taken immediately shows a faint bubble, so wait for opacity 1.
- The fixture clock is pinned to `FIXTURE_NOW`. Timing assertions about "slow" sends need the page clock shifted (see `e2e/fixture/send.playwright.ts`).
- Mentions are carried in the same `send` command. Check the payload's `mentions`, not a separate request.
