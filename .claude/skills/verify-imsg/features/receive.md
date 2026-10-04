# Receive a message

When the other person sends a message, it appears in the sidebar preview and, if the conversation is open, in the thread. The thread marks it read, a receive sound plays once, and the other person's typing shows as an indicator while they type.

## Sub-features

- `receive-sidebar` updates the row preview and the unread state.
- `receive-thread` appends the message to an open thread with no reload.
- `receive-preopen` shows a message seen in the sidebar immediately when the thread is opened before history loads.
- `receive-read` marks inbound messages read while the thread is open.
- `receive-typing` shows and clears the peer typing indicator.

## How to get to it (user POV)

- Leave the app open; messages arrive on their own.
- Open the conversation that just received a message.

## Driving it with Playwright (desk fixture)

Preconditions:

- Fixture healthy; doctor passes.
- Page loaded at `/` with the sidebar visible (`getByRole("heading", { name: "Needs reply" })`).

- **Inbound to a closed thread.** Call `await desk.receive(desk.chats.needs, "Inbound probe")`. The Alex Rivera row (`getByTestId("conversation-row").filter({ hasText: "Alex Rivera" })`) shows `Inbound probe` as its preview.
- **Open it.** Click that row. `getByTestId("thread-view")` contains exactly one `Inbound probe`.
- **Inbound to an open thread.** With the thread open, call `desk.receive(desk.chats.needs, "Second probe")`. The text appears once in the thread view without navigation.
- **Peer typing.** Call `desk.setTyping(desk.chats.needs, true)`. `getByLabel("Someone is typing")` appears at the bottom of the thread. `desk.setTyping(..., false)` removes it.
- **Read side effect.** After the open thread shows the message, `comma/outbox:enqueue` request bodies include `{ kind: "markRead" }` for that conversation.
- **Proof.** Screenshot the sidebar row before opening the thread and the thread after, plus an ARIA snapshot of `thread-view`.

## Gotchas

- The receive sound is deliberately silent on the initial page load, on reconnect and for backfill. Assert the sound only for a message that arrives after the page has loaded.
- Receive-sound logic tolerates the Mac's clock running ahead of the device. Do not assert that future-dated messages stay silent.
- `e2e/fixture/live-thread.playwright.ts` holds Convex message queries to prove the pre-open path. Reuse that pattern rather than adding sleeps.
