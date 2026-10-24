# imsg

Self-hosted iMessage client. The Expo/React-Native-Web app reads and sends through
Convex. A Bun/Hono server on the Mini bridges BlueBubbles and its SQLite overlay
into Convex, and serves session, release and deployment-health routes plus the web app.
The client has no feature REST calls or Mini event-stream connection.

## Language

**Chat Directory**:
The always-fresh, flag-annotated list of chat summaries the server maintains — BlueBubbles
data merged with the Overlay, unread counts, and the mark-read override.
_Avoid_: chat list cache, summaries cache

**Chat State**:
The pure rules for a chat's flags — how Unresponded/Waiting/Unread are derived
and how a new message flips them. Shared verbatim by server and client.
_Avoid_: filter logic, flag logic

**Overlay**:
App-local per-chat state stored in SQLite that BlueBubbles knows nothing about:
dismissal GUIDs, mute, pin, marked-unread.
Convex `comma_conversation_state` mirrors the Overlay. Client
writes go through the Convex outbox. The bridge applies them to SQLite and mirrors the result
back to Convex.
_Avoid_: overlay DB rows (when meaning the concept), local state

**Unresponded**:
A chat whose last message is inbound — you owe a reply. Dismissable until the next
inbound message; mutable per chat.

**Waiting**:
A chat whose last message is yours — you're waiting on them. Dismissable until the
next message flips the state.

**BlueBubbles seam**:
The single interface to BlueBubbles — REST operations plus the inbound event stream.
Two adapters: the HTTP/socket.io client in production, an in-memory fake in tests.
_Avoid_: BB client (when meaning the seam), API wrapper

**Directory fast path**:
Applying a known BlueBubbles event or command result directly to the Chat Directory
ahead of BlueBubbles' own DB catching up. The next full rebuild reconciles. The bridge
mirrors changes into Convex, whose live queries update clients.
_Avoid_: instant state sync, optimistic patch

**Identity Mirror**:
The server's in-memory read replica of the Convex identity graph's name directory
(`nameDirectory`), refreshed on an interval so the chat-list hot path never blocks
on the cloud. Convex is the canonical name source — it's a superset of Apple
Contacts (Apple names flow in via Identity Sync, plus manual in-app adds/renames,
which win over a stale Apple name). Looked up by raw address through the same
phone/email match-key seam (`shared/address.ts`) ContactBook uses.
_Avoid_: contact cache (when meaning this), name cache

**Name Resolution**:
How a participant's display name and `known` flag are decided: Identity Mirror
first, ContactBook fallback. ContactBook only fills the freshness gap — a contact
added to Apple Contacts within the last Identity Sync cycle, before it reached
Convex. `contactsAvailable` (and its Unknown-lens fail-open behavior) depends only
on ContactBook's own availability — the mirror being down/unconfigured degrades
silently to today's ContactBook-only resolution, never to "everything unknown."

**Draft**:
What sits unsent in a conversation's composer, one per conversation (`comma_drafts`). Either the
user's own text (`source: "user"`, or absent on older rows) or a reply an agent prepared
(`source: "agent"`) with an optional private `note` shown above the composer and stored
`attachments`. The Drafts tab lists every conversation with one, newest first. Opening one loads its
text and attachments into the composer; sending through the normal path or clearing deletes it.
Agents write them with `bun scripts/prepare-draft.ts --to <address|chatGuid|conversationId> --text …
[--note …] [--attach <path> …] [--force]`, which calls the internal `comma/drafts:prepareDraft`.
`comma/drafts:listAgentDrafts` and `comma/drafts:deleteAgentDraft` list and remove agent drafts.
_Avoid_: suggestion (the reply shelf), scheduled message

**Agent pane**:
The Agent tab in the shell's utility surface (⌘J), bound to the open conversation. A
conversation has any number of **agent chats** (`comma_agent_chats`), each open or settled, whose
**items** (`comma_agent_items`) are the transcript: the user's asks, assistant paragraphs, thinking,
tool steps, questions, drafts and turn ends. The pane's title is a switcher over the conversation's
chats; it shows a requested chat, else the most urgent open one, else an empty new chat that its
first ask creates. "New chat" leaves the other chats running, and the pane's Settle settles only
the chat it shows. Showing a chat while the window has focus marks its finished turn seen
(`seenAt`). A reply the agent drafts goes into the
composer as an agent Draft; when the user has typed there, it waits in the pane as a **pane draft**
with "Use in composer". The pane exists only while `aiStatus.agent` is true and the Settings toggle
is on. Plan: `docs/plans/comma-agent-pane.html`.
_Avoid_: assistant (that is one item kind), suggestion

**Agent attention**:
What an agent chat wants from the user, derived in `shared/agent-attention.ts` from its state,
`seenAt`, `lastTurnEndedAt` and `settledAt`: needs you (a question waits), failed, ready (a turn
ended unseen), working, open, or settled. A conversation carries its most urgent unsettled chat as
`ChatSummary.agent`, drawn as the avatar badge in every lens. Needs you includes every conversation
with an unsettled agent chat, and the Agents tab lists them grouped by attention. Settling a
conversation settles its agent chats and un-settling reopens them; sending the draft a chat wrote
settles that chat. On wide screens the pane opens itself on a conversation whose chat needs you, is
ready or failed. Plan: `docs/plans/comma-agent-threads.html`.
_Avoid_: status, unread (for agent chats)
