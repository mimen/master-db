# imsg

Self-hosted iMessage client. The Expo/React-Native-Web app reads and sends through
Convex. A Bun/Hono server on the Mini bridges BlueBubbles into Convex, runs the iMessage
side of queued commands, and serves session, release and deployment-health routes plus the web app.
The client has no feature REST calls or Mini event-stream connection.

## Language

**Conversation**:
One thread in Comma, whatever carries it, named everywhere by its Convex id (`comma_conversations`).
Its identity is a platform and account plus a key unique within that account; iMessage is the only platform, and
its service siblings (the iMessage, SMS and RCS chats with one person or group) share one key. Convex
owns the identity in `convex/comma/conversationIdentity.ts`: the key, the primary chat (newest
activity, ties to iMessage, then RCS, then SMS), and lookups by chat GUID or handle. Group CRM
(`chat_crm`, chat `tags`, chat `event_links`) belongs to the conversation.
_Avoid_: chat (for the merged thread), chat GUID (as an app-level id)

**Route**:
Where a command executes: a platform, an account, and that platform's thread id, for iMessage a chat GUID.
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
tapbacks, reply, edit, unsend, typing, mentions, scheduling, calls, attachments, FaceTime links, group management,
deleting) lists the services that carry it, whether it exists only in a group, and whether BlueBubbles needs its
Private API for it. The profile also holds how a route draws (`platformBadge`: the label and dot colour every
service mark reads), the composer's per-route setup (`composerConfig`: placeholder, send colour, Enter-sends and the
"Send with" options) and the edit and unsend windows. Enqueue rejects a command its route can't run (`convex/comma/routeSupport.ts`), and the client
shows that control greyed with the same short reason ("SMS can't send reactions") instead of hiding it.
_Avoid_: capability flags, service checks (`service === "SMS"`)

**Account**:
One signed-in identity on a platform (`comma_accounts`): the iMessage Mac today, later a Slack workspace or a
mailbox. Conversations, chat aliases, messages, attachments, scheduled messages and sync cursors carry its `accountId`,
so a conversation key or a message id only needs to be unique within its account. The bridge names its account at
startup (`POST /comma/ingest/account`, seeded idempotently) and stamps it on every batch; a bridge that names none
writes for iMessage's. A snapshot (unread, scheduled) replaces only its own account's state. Where a platform reports no
from-me flag, a sender among the account's `selfHandles` is me. Rows from before accounts carry no `accountId` and count as
their platform's only account's until the accounts backfill (`convex/comma/migrations.ts`) stamps them.
_Avoid_: workspace, login (for the stored identity)

**Message core**:
What every platform's message has (`messageCoreFields` in `convex/schema/comma/validators.ts`): platform, account, id,
conversation, sender, from-me, time, text, model text, attachments, reply-to, edited and retracted. iMessage's own fields (chat GUID,
service, send error, send effect, special content, associated-message) live under `imessage`; attachments keep chat.db's
fields (transfer name and state, UTI, sticker, on-disk) under their own `imessage`. Rows the backfill has not reached keep
those fields flat, so every reader goes through `convex/comma/messageShape.ts`, and reads serve both forms until every
client reads `imessage`. The bridge's flat BlueBubbles shape is `BridgeMessage` (`shared/types.ts`); clients turn one into a
`Message` with `fromBridgeMessage`. A message id is unique within its account, and every lookup by id goes through
`findMessage` (`convex/comma/conversationLookup.ts`); other tables name a message by its **message key**, `platform:id`
(`messageKey` in `convex/comma/reactions.ts`).
_Avoid_: guid (as a cross-platform id)

**Model text**:
What a model reads for a message, derived at ingest by the platform's adapter (`ToModelText` in `shared/model-text.ts`):
`modelText` (the body with quoted history, signatures, HTML and markup gone, new content first), an email's `subject`,
and the `threadRef` of a thread inside the conversation. iMessage's text is already clean, so it derives none. Every
model prompt renders messages through one formatter, `formatMessages` in `server/ai/context.ts`: it prefers model text,
neutralizes and fences untrusted text, labels speakers, and clips from the start of the body.
_Avoid_: cleaned text, prompt text

**Reaction**:
One sender's reaction to one message: a key (an iMessage tapback name like `love`, or `emoji:` and an emoji
tapback's emoji, as `emoji:😍`; what a react command sends), an optional emoji, and the sender. As in Messages, a
sender has one reaction per message: a new one replaces theirs, whatever its kind. `comma_reactions` holds each
sender's newest state per message and key, removals included, so an older event arriving late never undoes a newer
one; a sender's replaced reactions stay as removals. Rows written before keys were namespaced read as `emoji:`, and
reads show only a sender's newest. Ingest turns an iMessage tapback into a reaction and stores no message row for it.
The tray offers the route's reaction set from its platform profile, and an emoji picker where the route has
`emojiReact`. Sending an emoji also needs the Mac's BlueBubbles to say it can (`custom_emoji_reactions` in its server
info, proposed upstream and absent through 1.9.12); the bridge state carries it as `emojiReactions`, and the picker
greys with the reason until then.
_Avoid_: tapback (outside iMessage-specific code), tapback row

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

**Pending send**:
A message the user sent that has not landed as the platform's own copy, keyed by its outbox `clientKey` and drawn
as the row `temp-<clientKey>`. Convex owns its lifecycle in `convex/comma/pendingSends.ts` and the client in
`client/src/lib/pending-sends.ts`, for every platform. It is queued (cancellable: Cancel removes the bubble and the
outbox row, and it never goes out), then sending once the executor claims it, then lands; or it strands as Not sent
(nothing took it within `NOT_SENT_AFTER_MS`, so a retry is safe) or failed (refused, or its outcome is unknown).
Nothing retries a stranded send but the user's tap. A send made while Convex is unreachable waits on the device and
goes out on reconnect, under the same deadline counted from the gesture. Until Convex has it, the device also keeps it
in storage, so a reload or a closed tab restores it under its clientKey; one tab at a time owns each kept send through a
Web Lock. The bubble says "Waiting to send" at once when Convex or the Mini is out of reach, and after a second when the
Mini is up but has not taken it. Attachments and voice memos are not pending sends yet. See `shared/pending-send.ts`.
_Avoid_: temp message, optimistic send, local send

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
