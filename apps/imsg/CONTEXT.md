# imsg

Self-hosted iMessage client. The Expo/React-Native-Web app reads and sends through
Convex. A Bun/Hono server on the Mini bridges BlueBubbles into Convex, runs the iMessage
side of queued commands, and serves session, release and deployment-health routes plus the web app.
The client has no feature REST calls or Mini event-stream connection.

## Language

**Conversation**:
One thread in Comma, whatever carries it, named everywhere by its Convex id (`comma_conversations`).
Its identity is a platform plus a key unique within that platform; iMessage is the only platform, and
its service siblings (the iMessage, SMS and RCS chats with one person or group) share one key. Convex
owns the identity in `convex/comma/conversationIdentity.ts`: the key, the primary chat (newest
activity, ties to iMessage, then RCS, then SMS), and lookups by chat GUID or handle. Group CRM
(`chat_crm`, chat `tags`, chat `event_links`) belongs to the conversation.
_Avoid_: chat (for the merged thread), chat GUID (as an app-level id)

**Route**:
Where a command executes: a platform and that platform's thread id, for iMessage a chat GUID.
Enqueue stamps the conversation's primary chat on each outbox row; the bridge runs exactly the
stamped route and never picks one.
_Avoid_: send target, resolved chat

**Chat State**:
The pure rules for a chat's flags: how Unresponded/Waiting/Unread derive from its triage
state and last message, and which lens it matches. Convex computes flags with them and the
client filters with them.
_Avoid_: filter logic, flag logic

**Platform profile**:
What a route can do, as data in `shared/platform-profile.ts`: per platform, each feature (reactions and which
tapbacks, reply, edit, unsend, typing, mentions, scheduling, attachments, FaceTime links, group management,
deleting) lists the services that carry it, whether it exists only in a group, and whether BlueBubbles needs its
Private API for it. Enqueue rejects a command its route can't run (`convex/comma/routeSupport.ts`), and the client
shows that control greyed with the same short reason ("SMS can't send reactions") instead of hiding it.
_Avoid_: capability flags, service checks (`service === "SMS"`)

**Triage state**:
Comma's own per-conversation state that BlueBubbles knows nothing about: dismissal anchors,
pin, mute, marked-unread, the read time, and the clear log of settles and replies. Convex owns it
in `comma_conversation_state` and `comma_triage_events` and is its only writer. Clients write it
with `comma/triage` mutations whose optimistic updates show the change in the frame of the
gesture; only a read goes on to the Mini, for iMessage's read receipt. A settle anchors on the
conversation's last message in Convex, the one every client shows. Message ingest logs a reply
when a real send follows an unsettled inbound message. `comma_triage_open` is retired: nothing
reads or writes it.
_Avoid_: overlay (for this state), local state

**Overlay**:
The Mini's SQLite file (`OverlayDb`): bridge cursors and versions, AI caches, transcripts.
Its `chat_state`, `triage_clear_event` and `triage_open_item` tables held triage state before
Convex took it over; nothing writes them, and they stay as a rollback copy.
_Avoid_: overlay DB rows (when meaning the concept)

**Outbox lane**:
The executor a queued command waits for, stamped on its `comma_outbox` row at enqueue: one lane per
messaging platform (only `imessage` today) and an `ai` lane for suggestions, identify, suggestion
feedback, clearing learning and transcription. The Mini drains each lane in its own loop, one command
at a time, so a slow model call never holds back a send. AI work reads the conversation from Convex
by conversation id, never from BlueBubbles. The lease, claim token, retry policy and receipts are
shared by every lane.
_Avoid_: queue (when meaning one lane), worker

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

**Service siblings**:
The per-service chats (`iMessage;-;X`, `SMS;-;X`, an RCS fork) that the bridge mirrors into one
Convex conversation. React, delete, delete chat, scheduled edits and the read receipt act across
them. The bridge's `MessageWriter.siblingGuids` answers from the conversation ids Convex returned
for each chat; the Mini keeps no chat list of its own.
_Avoid_: aliases (Convex's table name for the same mapping), duplicates

**Identity Mirror**:
The Mini's in-memory read replica of the Convex identity graph's name directory
(`nameDirectory`), refreshed on an interval. It names people only for work the Mini
still does itself: reply-suggestion and identify prompts, and the scheduled-message name.
It is not on the bridge's ingest path. The bridge posts raw addresses, and Convex names
them (see Name Resolution).
_Avoid_: contact cache (when meaning this), name cache

**Name Resolution**:
Convex names participants when it serves a query, not when the Mini ingests. Each
participant address resolves through the identity graph (`identities.by_normalized`, then
its `people` row), memoized per query. That gives the conversation's `displayName`,
participant names, message and reaction sender names, the last-message sender, the
Today row title, the agent context, and `searchNames`, every name a participant's person
goes by. A rename in the graph (an in-app rename, or an Apple name arriving through
Identity Sync) shows everywhere on the next read. A named group chat keeps the name the
chat itself carries; an unnamed group lists its members. `known` means a participant
resolves to a person with a name. Auto-clustered people without a name do not count. Convex
computes `known` and sends it to the client. `contactsAvailable` is false while the graph
holds no Apple contact identities, so a graph that never received Apple Contacts fails the
Unknown lens open instead of screening everything. Names the Mini stored on older rows are
ignored.

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
