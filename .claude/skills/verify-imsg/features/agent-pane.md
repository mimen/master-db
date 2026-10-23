# Agent pane

A user presses ⌘J in an open conversation and the Agent tab opens in the right-hand utility pane, bound to that conversation, with its input focused. A conversation can have several agent chats, open or settled; the pane's title is a switcher listing them. Asking shows the reply as markdown with the agent's steps folded into one "Worked for Ns · N steps" row. A question from the agent arrives as a card the user answers by tapping or with a number key. A reply the agent drafts lands in the composer, or waits in the pane with "Use in composer" when the user has typed there. "New chat" starts another chat and leaves the others running. The pane's Settle settles only the chat it shows. With the pane closed, the state strip says what the conversation's most urgent open chat wants, and clicking it opens the pane on that chat.

## Sub-features

- `agent-open` opens the pane with ⌘J and focuses its input; Esc returns focus to the composer and leaves the pane open.
- `agent-ask` sends an ask through `comma/agent:ask` with a client key, `steer` from the vendored T3 dispatch rule, and the model and effort from Settings.
- `agent-transcript` renders the user message, assistant markdown, a folded work log that expands to its steps, and always-visible failures and questions.
- `agent-question` answers a question card with a tap, a number key, or Other with free text.
- `agent-draft-composer` puts a drafted reply and its note into an empty composer.
- `agent-draft-pane` holds the draft in the pane when the user typed in the composer; "Use in composer" replaces their text and marks the item used.
- `agent-switcher` lists the conversation's open chats (state dot, title, state word or a working chat's elapsed time) under the person's name, then Settled chats with their dates, then New chat. The pane shows a requested chat (openAgentPane's chat id, or the phone route's `chat` param), else the most urgent open chat, else a new one, and keeps it until the user switches.
- `agent-new-chat` shows an empty chat and leaves the other chats running; the first ask sends no `chatId`, the server creates the chat, and the pane follows it.
- `agent-settle` settles only the shown chat. A settled chat reads under a "Settled <day>" bar with Reopen; asking in it reopens it.
- `agent-seen` calls `comma/agent:markSeen` while the pane shows a chat whose last turn ended after `seenAt` and the window is focused and visible, so a ready chat turns open once looked at and a turn that ends while watched never reads ready.
- `agent-strip` reads the most urgent open chat's attention while the pane is closed: "Agent is asking you something", "Agent is working", "Agent drafted a reply", "Agent replied", or "Agent hit an error". An open chat shows nothing.
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
- `AGENT_CHAT_GUIDS` in `e2e/fixture/world.ts` seeds one chat per attention: Diego Santos needs you, Riley Chen ready with a draft in the pane, Taylor Morgan working (until Stop), Priya Shah failed, Marcus Reed open. Leah Kim (`several`) has Rideshare codes (ready), Hotel block for the crew (open), and two settled chats, Flyer feedback (yesterday) and Leah's birthday dinner (two days ago).

- **Open.** Go to `/chat/<needs>`, click the composer, press `Meta+j`. `getByTestId("agent-pane")` is visible with the switcher `getByRole("button", { name: "Agent chat, New chat" })` and the empty line "Ask about Alex Rivera.", and `getByRole("textbox", { name: "Ask the agent" })` is focused. `Escape` focuses `getByPlaceholder("iMessage")`.
- **Ask.** Fill the input and press Enter. `getByTestId("agent-user-message")` shows the text; after one scripted step `getByTestId("agent-reply")` shows the markdown reply and `getByTestId("agent-work")` reads `Worked for Ns · 2 steps`. Its button expands the steps.
- **Question.** Ask anything containing "guest list". `getByTestId("agent-question")` shows radios `Freaquency 10/31`, `Afterparty 11/1` and `Other`. With the empty input focused, press `1`; the card resolves to `Freaquency 10/31`.
- **Draft in the composer.** The composer's value becomes the drafted reply and `getByTestId("draft-note")` shows the agent's note.
- **Strip.** Close with `getByRole("button", { name: "Close agent" })`. A turn the user watched end is seen, so the strip shows no chip; `Agent is asking you something` shows while a question waits. Clicking it opens the pane on that chat.
- **New chat.** `getByRole("button", { name: "New chat", exact: true })` empties the transcript; `comma/agent:chatsFor` still lists the old chat with no `settledAt`, and a second chat appears on the first ask.
- **Switcher.** On Leah Kim, `getByRole("button", { name: /^Agent chat, / })` opens `getByRole("listbox", { name: "Agent chat" })`. Its options read `Rideshare codes` (Ready, then Open once seen), `Hotel block for the crew` (Open), `Flyer feedback` (Yesterday), `Leah's birthday dinner` (a weekday) and `New chat`; a working chat's row ends in its elapsed seconds.
- **Settle and Reopen.** `getByRole("button", { name: "Settle", exact: true })` calls `comma/agent:settle` for the shown chat only and no `comma/outbox:enqueue` settle; `getByTestId("agent-settled-bar")` reads `Settled <time>` (a weekday or date for older chats, like a read receipt) with Reopen (`comma/agent:reopen`). An ask in a settled chat carries its `chatId` and the bar goes.
- **Seen.** Riley Chen's chip reads `Agent drafted a reply`; opening the pane calls `comma/agent:markSeen` once, `chatsFor` reports `seenAt ≥ lastTurnEndedAt`, and after closing the pane the chip is gone.
- **Phone.** At 390 px the strip chip pushes `/agent?guid=…&chat=<id>` and the pane shows that chat. The phone header drops its New chat button for room; the switcher's menu carries New chat.
- **Pane draft.** Type in the composer and wait until `comma/queries:getDraft` reports `source: "user"`. Ask about the guest list again and answer. `getByTestId("agent-draft")` shows the reply while the composer keeps the typed text. "Use in composer" replaces it and turns into a disabled "In the composer".
- **Side effects.** Capture `/__fixture/convex` bodies named `comma/agent:ask`, `answer`, `settle` and `useDraft`; re-read `comma/agent:chatsFor` and `comma/agent:listItems` for the stored items.
- **Proof.** Run `drives/agent-pane.ts`. It writes `01-before.png` through `30-strip-*.png`, `aria-question.txt`, `aria-switcher.txt`, `aria-settled.txt`, `aria.txt` and the `side-effects*.json` files. `drives/agent-pane-shots.ts` writes the light and dark `batch3-*.png` shots of the switcher, a chat working elsewhere, a settled chat, every strip chip and the phone pane.

## Gotchas

- The scripted agent waits 400 ms per step, so assert with `expect(...).toBeVisible()` or `expect.poll`, never a fixed sleep.
- The fixture's `useQuery` polls every 500 ms. A pending ask is drawn locally at once, but server items appear on the next poll.
- The composer saves typed text after a 600 ms debounce. A guest-list answer before that save sees an empty composer and drafts into it instead of the pane.
- Number keys answer only from outside text fields or from the empty agent input. Typing a digit in the composer types it.
- The pane follows the selection. Opening another conversation shows that conversation's chat, not the previous one's.
- Ionicons draw their glyphs as text, so an option or chip's text starts with a private-use character. Match option text with a regex anchored at the end, and the chip with `toContainText`.
- A cold load of `/agent` on a phone returns to the list, because the route closes while the runner's status is still loading. Reach the phone pane through the chip or the header's sparkles button.
