# Platform profile

What a conversation can do comes from its route's platform profile (`apps/imsg/shared/platform-profile.ts`). On an SMS or RCS route, the message menu shows Reply, Edit and Undo send greyed with a short reason, and the tapback tray shows greyed with "SMS can't send reactions". A keyboard pick in the tray does nothing but repeat the reason. An iMessage route shows every control live. Convex refuses a command the route can't run, with the same reason.

## Sub-features

- `profile-sms-menu` greys the tray, Reply, Edit and Undo send on an SMS message, each with its reason, and leaves Copy, Forward and Delete for Me live.
- `profile-sms-keyboard` shows the reason as a toast when Enter picks a greyed tapback, and sends nothing.
- `profile-sms-enqueue` rejects a `react` enqueue for an SMS conversation with `SMS can't send reactions`.
- `profile-imessage` keeps every control live on an iMessage message, and a tapback lands on the stored row.

## How to get to it (user POV)

- Open Sam Chen (an SMS chat), send a message, then right-click or long-press it.
- Open Alex Rivera (iMessage), send a message, then right-click it.

## Driving it with Playwright (desk fixture)

The drive is `apps/imsg/e2e/fixture/golden-platform-profile.playwright.ts`. It records every `comma/outbox:enqueue` body.

- **SMS menu.** Search Sam Chen, send `SMS profile probe` with the `Text Message` composer, and right-click the bubble (`getByTestId("message-bubble")`). The `Tapbacks` toolbar has `aria-disabled="true"`, and the Reply, Edit and Undo send menu items are disabled with their reason text under each.
- **Keyboard.** Press Enter with the tray focused. A toast reads `SMS can't send reactions` and no `react` command is enqueued. No `typing` command was sent while typing either.
- **Enqueue.** POST `comma/outbox:enqueue` with a `react` payload for `fixtureConversationId(desk.chats.coldSms)`. The answer is 400 with `{ error: "SMS can't send reactions" }`.
- **iMessage.** Repeat in Alex Rivera. Every item is enabled, Edit shows `15 min left`, and choosing Love stores a `love` reaction, read back through `comma/queries:listMessages`.

## Gotchas

- Edit and Undo send appear only inside their windows, so shift the page clock to `FIXTURE_NOW` before sending, as the drive does.
- The bubble and its sidebar row share the accessible name `You: <text>`. Target the bubble by its `message-bubble` test id.
- The fixture world has no SMS group, so the greyed name, Add person and Leave conversation in an SMS group's Details have no drive. `shared/platform-profile.test.ts` and `convex/comma/outbox.test.ts` cover them.
- The fixture's fake Convex rejects through the same `unsupportedReason` that Convex's enqueue uses (`convex/comma/routeSupport.ts`).
