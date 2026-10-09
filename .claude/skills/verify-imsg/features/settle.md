# Settle a conversation

Settling marks a conversation handled: it leaves Needs reply or Waiting, a `Settled <Name>` toast appears with `Undo`, and Undo (or ⌘Z outside a text field, ⌘⇧Z anywhere) restores it. In Needs reply and Unread, settling opens the next conversation at once. A reply stays on the conversation, which holds its place in the lens until it is left or settled. Settling an already-settled conversation from the All view reverses it.

## Sub-features

- `settle-row` settles from the row's Settle button.
- `settle-strip` settles from the state strip above the composer.
- `settle-key` settles with Cmd+E in an open thread.
- `settle-undo` restores the conversation from the toast's Undo.
- `settle-unsettle` un-settles a settled conversation from the All view.

## How to get to it (user POV)

- Hover a row in Needs reply and choose `Settle`.
- Open a conversation and choose `Settle ⌘E` in the state strip above the composer.
- Open a conversation and press Cmd+E.

## Driving it with Playwright (desk fixture)

Preconditions:

- Fixture healthy; doctor passes.
- Viewport at least 1300x820, so the header and toast layout match desktop.

- **Settle by keyboard.** Read the count off the `Needs reply, N conversations` radio (rows are virtualized, so counting rows undercounts), click the first row, then `page.keyboard.press("Meta+e")`. `getByText("Settled <Name>", { exact: true })` and `getByRole("button", { name: "Undo", exact: true })` appear in the lower half of the viewport.
- **Settle from the strip.** Open a thread and click `getByTestId("thread-settle")` (accessible name `Settle (⌘E)`). The result is the same toast. A settled thread's strip reads `Settled · Back in Needs reply if <first name> texts again` with `Un-settle (⌘E)`.
- **Auto-advance and position.** The thread top bar shows `N of M` with `Previous conversation (K)` and `Next conversation (J)`. `drives/settle-loop.ts` proves the whole loop.
- **Settle from a row.** Hover a row and click `row.getByRole("button", { name: "Settle <Name>" })`. The row leaves the Needs reply list.
- **Undo.** Click `Undo`. The toast disappears and the row count returns to its value before settling.
- **Un-settle.** In the All view, a settled row's button reads `Un-settle <Name>`. Clicking it shows `Un-settled — back in Needs Reply`.
- **Side effect.** `comma/outbox:enqueue` bodies carry `{ kind: "settle" }`, then `{ kind: "unsettle" }` after Undo.
- **Proof.** Screenshot with the toast visible, then after Undo, plus an ARIA snapshot of the sidebar list.

## Gotchas

- The toast must not reflow the message list. Measure row positions before and after if you are checking layout (see `e2e/fixture/toast-layout.playwright.ts`).
- Cmd+E does nothing while focus is in the composer and text is selected. Click the row first.
