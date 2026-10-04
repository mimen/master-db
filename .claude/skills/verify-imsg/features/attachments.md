# Send attachments

A user stages one or more files (or records a voice memo) and sends them. Each file uploads to Convex storage and goes out as its own message. A typed caption rides on the first attachment only. A voice memo goes out flagged as an audio message.

## Sub-features

- `attach-drop` stages files by dropping them on the thread.
- `attach-caption` sends the caption with the first attachment only.
- `attach-voice` records and sends a voice memo; a short take or Esc sends nothing.
- `attach-unknown` shows an outcome-unknown toast and does not retry.

## How to get to it (user POV)

- Drag files onto an open conversation, optionally type a caption, then choose `Send`.
- Choose the `+` button in the composer to pick files.
- Choose `Record voice message`, speak, then choose `Send voice message`.

## Driving it with Playwright (desk fixture)

Preconditions:

- Fixture healthy; doctor passes.
- Alex Rivera's thread is open.
- For voice, grant the microphone first: `page.context().grantPermissions(["microphone"])`.

- **Stage by drop.** Dispatch a `drop` `DragEvent` on `getByTestId("thread-view")` with a `DataTransfer` holding `new File(["first"], "first.txt", { type: "text/plain" })` and a second file. `getByRole("button", { name: "Remove attachment" })` has count 2.
- **Caption and send.** `getByPlaceholder("iMessage").fill("Here are the notes")`, then click `Send`. The thread shows `first.txt` and `second.txt`.
- **Side effect.** The `comma/outbox:enqueue` bodies hold two `sendAttachment` payloads. The first has `caption: "Here are the notes"`; the second has no caption; both have `isAudioMessage: false`. Uploads POST to `/__fixture/upload` before each enqueue.
- **Voice.** Click `Record voice message`. A short take or Esc results in zero uploads. A take longer than one second followed by `Send voice message` results in one upload and an `isAudioMessage: true` payload.
- **Proof.** Screenshot with the staged chips and after send, plus the captured payloads in `side-effects.json`.

## Gotchas

- The fixture's fake BlueBubbles may answer `not implemented in fake` for attachment sends. The fixture then falls back to a text echo with the attachment attached. That is expected, and is not a client bug.
- Voice timing depends on `Date.now`. `e2e/fixture/batch-e-voice.playwright.ts` freezes the page clock to make short and long takes deterministic.
- Never assert on a Mini `/api/.../attachment` request. Uploads go to Convex storage, and the `desk` fixture fails any Mini call.
