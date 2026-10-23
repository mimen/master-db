# Agent chats in the conversation list

Every conversation row with an unsettled agent chat carries an avatar badge for what its most urgent chat wants: `?` needs you, `!` failed, a sparkle ready, a turning ring working, an outlined sparkle open. Needs reply includes those conversations, and a row that is there only for its agent keeps a gray time. The Agents tab, a sparkle with a count after Drafts, groups those people under Needs you, Failed, Ready, Working and Open, and each row there adds the chat's title and a status line. Settling a conversation settles its agent chats, and Un-settle reopens them. On wide layouts, opening a conversation whose agent needs you, is ready or failed opens the agent pane, as does any pick in the Agents tab. On web and the desktop shell, a chat elsewhere that turns needs you, ready or failed shows a toast with Open. ⌘K lists agent chats by title and person.

## Sub-features

- `agent-badge` draws the badge in every lens and adds the state to the row's spoken label ("agent needs you", "agent failed", "agent finished", "agent working", "agent chat open").
- `agent-needs-reply` keeps a conversation with an unsettled agent chat in Needs reply and its count, with a gray time when no reply is owed.
- `agent-lens` is the sixth tab (`⌘6`, accessible name `Agents, N`). N counts needs you, failed and ready. Rows group by attention, newest agent activity first, with the title, `· N chats` when more than one is open, a status line and the agent's own time.
- `agent-settle` carries ⌘E, the row's Settle chip and the phone swipe to the conversation's agent chats; a pending settle drops the badge in the same frame.
- `agent-auto-open` opens the pane on wide layouts only. Focus stays where the open put it.
- `agent-toast` toasts `<name> · agent needs you`, `· agent finished` or `· agent failed` unless that conversation is selected with the pane open; nothing for the first list.
- `agent-palette` adds an "Agent chats" group to ⌘K, blank or typed; picking one opens the conversation and the pane on that chat.

## How to get to it (user POV)

- Any lens shows the badges. The sparkle tab after Drafts is the Agents lens; ⌘6 reaches it on desktop, and on a phone the lens tabs scroll to it.
- Click a row to open it; the pane opens itself when the badge is `?`, `!` or a filled sparkle, and for every row in the Agents lens.
- ⌘E, the row's Settle chip or a phone swipe settles the conversation and its agent chats.
- ⌘K, then type a chat's title or the person's name.

## Driving it with Playwright (desk fixture)

Preconditions:

- Fixture healthy; doctor passes.
- The fixture world seeds agent chats (`AGENT_CHAT_GUIDS` in `e2e/fixture/world.ts`): Diego Santos needs you, Riley Chen ready with a draft, Taylor Morgan working, Priya Shah failed, Marcus Reed open, Leah Kim two open and two settled. Alex Rivera has none.

Steps (`drives/agent-list.ts`):

- **Badges.** In the All lens, each of those rows' `aria-label` reads `<name>, unread, <state>, …` and holds `getByTestId("agent-badge")`. Alex has none.
- **Needs reply.** Open Marcus, send a reply, open Alex, then choose Needs reply. Marcus stays with `You: …`, the tab's count is unchanged, and his age's computed color differs from Alex's persimmon one.
- **Agents tab.** `getByRole("tab", { name: "Agents, 4" })`. The group headers and rows read Needs you, Diego, Failed, Priya, Ready, Riley, Leah, Working, Taylor, Open, Marcus. Riley's row reads `Draft ready · You're on the list for Friday, see you there`; Leah's `Rideshare codes · 2 chats`.
- **Auto-open.** In the Agents tab, clicking Taylor opens `getByTestId("agent-pane")`. In All, clicking Marcus leaves it shut and clicking Riley opens it with the composer still focused.
- **Toast.** With Alex open and the pane shut, the drive calls `comma/agent:ask` on Taylor's chat through `/__fixture/convex`; it stands in for the runner, and the scripted agent ends the turn 400 ms later. `getByText("Taylor Morgan · agent finished")` appears; its Open button opens Taylor with the pane.
- **Settle.** In Needs reply, open Diego and press `Meta+e`. His row leaves; `comma/agent:chatsFor` shows his chat with a `settledAt`. In All, hover his row and choose `Un-settle Diego Santos`; he is back in Needs reply with a badge and the chat has no `settledAt`. The client enqueued `settle` then `unsettle`.
- **Palette.** `Meta+k` shows an "Agent chats" header. Typing `guest` lists "Reply about the guest list"; clicking it opens Riley with the pane.
- **Phone.** At 390 by 844, the Agents tab is reachable by scrolling the lens tabs and shows the same groups.
- **Proof.** The drive writes `01-all-light.png` through `15-phone-agents.png`, `aria-agents.txt`, `aria-palette.txt` and `side-effects.json`.

## Gotchas

- Rows match on their visible name; `rows.filter({ hasText })` also matches a status line that mentions the name, so assert on the row you mean.
- The All lens order puts the agent conversations under "Older" because the fixture clock is pinned; the Agents lens orders by agent activity instead.
- The scripted agent marks nothing seen. A chat stays Ready after its pane opens until the pane marks it seen, which is the pane's job.
- `useReducedMotion` reads the media query at load: reload after `emulateMedia({ reducedMotion })` to see the turning ring rather than the dotted one.
- Settling Diego interrupts his waiting question, so after Un-settle his chat is open, not needs you.
