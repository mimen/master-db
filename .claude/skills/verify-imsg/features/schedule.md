# Schedule a message

A user writes a message and chooses Send later. A menu and then a date editor open anchored above the Send button. Saving queues the message, and it appears in the Scheduled list, where it can be edited, cancelled or sent now.

## Sub-features

- `schedule-menu` opens Send later anchored above Send.
- `schedule-editor` opens the date editor and saves.
- `schedule-list` shows the new item in Scheduled.
- `schedule-edit` / `schedule-cancel` / `schedule-now` handle edit, cancel (with rollback on failure) and Send now.

## How to get to it (user POV)

- Type in the composer, choose the `Schedule message` button, then `Choose Date & Time…`, then `Save schedule`.
- Open Scheduled from the left rail to manage queued messages.

## Driving it with Playwright (desk fixture)

Preconditions:

- Fixture healthy; doctor passes.
- A Needs reply conversation is open.

- **Open Send later.** `getByPlaceholder("iMessage").fill("Doors at 8")`, then `getByRole("button", { name: "Schedule message" }).click()`. `getByText("Choose Date & Time…", { exact: true })` appears, with its right edge aligned to the Send button and sitting above it.
- **Editor.** Click that item. `getByText("Choose Date & Time", { exact: true })` and `getByRole("button", { name: "Save schedule" })` appear above Send.
- **Save.** Click `Save schedule`. The composer clears.
- **Side effect.** `comma/outbox:enqueue` carries `{ kind: "schedule", text: "Doors at 8", sendAt }`. Then `comma/queries:listScheduled` returns a row with that text and status `pending`.
- **List.** Click the rail item labelled `Scheduled` (or go to `/scheduled`). The item shows with its send time.
- **Proof.** Screenshot of the anchored menu, the editor, and the Scheduled list, plus the enqueued payload.

## Gotchas

- Send now does not send separate text. It moves the scheduled job's time to now, and the scheduler delivers it. Verify one delivered message, not two.
- Cancel hides the item optimistically. With a send fault injected, it must reappear (rollback).
