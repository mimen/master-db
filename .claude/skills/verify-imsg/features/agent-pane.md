# Agent pane

A user presses ⌘J in an open conversation and the Agent tab opens in the right-hand utility pane, bound to that conversation, with its input focused. Asking shows the reply as markdown with the agent's steps folded into one "Worked for Ns · N steps" row. A question from the agent arrives as a card the user answers by tapping or with a number key. A reply the agent drafts lands in the composer, or waits in the pane with "Use in composer" when the user has typed there. "New chat" clears the transcript. With the pane closed, the state strip says when the agent is working, asking, or has drafted a reply, and clicking it reopens the pane.

## Sub-features

- `agent-open` opens the pane with ⌘J and focuses its input; Esc returns focus to the composer and leaves the pane open.
- `agent-ask` sends an ask through `comma/agent:ask` with a client key, `steer` from the vendored T3 dispatch rule, and the model and effort from Settings.
- `agent-transcript` renders the user message, assistant markdown, a folded work log that expands to its steps, and always-visible failures and questions.
- `agent-question` answers a question card with a tap, a number key, or Other with free text.
- `agent-draft-composer` puts a drafted reply and its note into an empty composer.
- `agent-draft-pane` holds the draft in the pane when the user typed in the composer; "Use in composer" replaces their text and marks the item used.
- `agent-new-chat` archives the live chat and empties the transcript.
- `agent-strip` shows working, asking or drafted in the state strip while the pane is closed.
- `agent-settings` hides the pane, ⌘J and the strip when Settings turns the Agent pane off, or when `aiStatus.agent` is false.

## How to get to it (user POV)

- Open a conversation and press ⌘J, or choose the agent button in the thread header.
- With the pane closed, choose the agent chip in the state strip above the composer.
- On a phone, choose the sparkles button in the conversation header; the pane opens as a modal.
- Settings, group Agent, holds the on/off toggle, the model and the effort.

## Driving it with Playwright (desk fixture)

Preconditions:

- Fixture healthy; doctor passes.
- The fixture's fake Convex answers the `comma/agent:*` functions with a scripted agent (`e2e/fixture/agent.ts`) and reports `aiStatus.agent: true`.
- Alex Rivera (`desk.chats.needs`) has no agent chat after the reset.

- **Open.** Go to `/chat/<needs>`, click the composer, press `Meta+j`. `getByTestId("agent-pane")` is visible with the heading `Agent · Alex Rivera`, and `getByRole("textbox", { name: "Ask the agent" })` is focused. `Escape` focuses `getByPlaceholder("iMessage")`.
- **Ask.** Fill the input and press Enter. `getByTestId("agent-user-message")` shows the text; after one scripted step `getByTestId("agent-reply")` shows the markdown reply and `getByTestId("agent-work")` reads `Worked for Ns · 2 steps`. Its button expands the steps.
- **Question.** Ask anything containing "guest list". `getByTestId("agent-question")` shows radios `Freaquency 10/31`, `Afterparty 11/1` and `Other`. With the empty input focused, press `1`; the card resolves to `Freaquency 10/31`.
- **Draft in the composer.** The composer's value becomes the drafted reply and `getByTestId("draft-note")` shows the agent's note.
- **Strip.** Close with `getByRole("button", { name: "Close agent" })`. `getByTestId("agent-strip")` reads `Agent drafted a reply` (or `Agent is asking you something` while a question waits). Clicking it reopens the pane.
- **New chat.** `getByRole("button", { name: "New chat" })` empties the transcript; `comma/agent:liveChat` returns null.
- **Pane draft.** Type in the composer and wait until `comma/queries:getDraft` reports `source: "user"`. Ask about the guest list again and answer. `getByTestId("agent-draft")` shows the reply while the composer keeps the typed text. "Use in composer" replaces it and turns into a disabled "In the composer".
- **Side effects.** Capture `/__fixture/convex` bodies named `comma/agent:ask`, `answer`, `newChat` and `useDraft`; re-read `comma/agent:liveChat` and `comma/agent:listItems` for the stored items.
- **Proof.** Run `drives/agent-pane.ts`. It writes `01-before.png` through `09-used-in-composer.png`, `aria-question.txt`, `aria.txt` and `side-effects.json`.

## Gotchas

- The scripted agent waits 400 ms per step, so assert with `expect(...).toBeVisible()` or `expect.poll`, never a fixed sleep.
- The fixture's `useQuery` polls every 500 ms. A pending ask is drawn locally at once, but server items appear on the next poll.
- The composer saves typed text after a 600 ms debounce. A guest-list answer before that save sees an empty composer and drafts into it instead of the pane.
- Number keys answer only from outside text fields or from the empty agent input. Typing a digit in the composer types it.
- The pane follows the selection. Opening another conversation shows that conversation's chat, not the previous one's.
