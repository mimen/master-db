# Conversation identity

A conversation opens at `/c/<conversationId>`, and the client names it by that Convex id in every command, triage write and query. A link from before that, `/chat/<chat GUID>` or `/chat/<handle>`, resolves once to its conversation and redirects. A group's details and CRM load by the same id.

## Sub-features

- `identity-url` opens a conversation at `/c/<conversationId>`.
- `identity-commands` sends a message and settles it with the conversation id in the outbox and triage writes, and no conversation-scoped call carries a chat GUID.
- `identity-legacy-links` redirects `/chat/<chat GUID>` and `/chat/<handle>` to `/c/<conversationId>`.
- `identity-group-crm` shows a group's Details, tags and CRM, read by conversation id.

## How to get to it (user POV)

- Choose a conversation in the sidebar. The address bar shows `/c/<id>`.
- Open an old bookmark or notification link of the form `/chat/<guid>`.
- Open a group, then choose Conversation info.

## Driving it with Playwright (desk fixture)

The drive is `apps/imsg/e2e/fixture/golden-conversation-identity.playwright.ts`. It records every `/__fixture/convex` request body.

- **URL.** Choose the Alex Rivera row. The URL ends with `/c/${fixtureConversationId(desk.chats.needs)}`.
- **Commands.** Send with Enter, then press ⌘E. The `comma/outbox:enqueue` send and `comma/triage:settle` both carry that id. No recorded `conversationId` contains `;`, and the client makes no `comma/queries:resolveChat` call. `comma/queries:listMessages` for that id returns the sent row.
- **Legacy links.** Go to `/chat/${encodeURIComponent(desk.chats.needs)}`, then `/chat/%2B16195550101`. Both land on `/c/<id>` with Alex's thread.
- **Group CRM.** Go to `/c/${fixtureConversationId(desk.chats.unreadGroup)}` and choose Conversation info. The `launch` tag shows, and `comma/conversationInfo:chatInfo` was called with `{ conversationId }`.

## Gotchas

- Fixture conversation ids differ from chat GUIDs only at the `/__fixture/convex` boundary. Build them with `fixtureConversationId()` from `apps/imsg/shared/fixture-ids.ts`. A GUID passed as an id finds nothing.
- Waiting conversations have no Settle button on the state strip. Settle them with ⌘E or the row's Settle.
- Arriving through a `/chat/` redirect sets the selection after the list loads, so the agent pane may open itself on a conversation that needs you. Drives that check the state strip should go straight to `/c/<id>`.
