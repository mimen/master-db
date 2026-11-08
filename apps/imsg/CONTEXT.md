# imsg

Self-hosted iMessage client. The Expo/React-Native-Web app reads and sends through
Convex. A Bun/Hono server on the Mini bridges BlueBubbles into Convex, runs the iMessage
side of queued commands, and serves session, release and deployment-health routes plus the web app.
The client has no feature REST calls or Mini event-stream connection.

## Language

**Conversation**:
One thread in Comma, whatever carries it, named everywhere by its Convex id (`comma_conversations`).
Its identity is a platform and account plus a key unique within that account. On iMessage
its service siblings (the iMessage, SMS and RCS chats with one person or group) share one key. Convex
owns the identity in `convex/comma/conversationIdentity.ts`: the key, the primary chat (newest
activity, ties to iMessage, then RCS, then SMS), and lookups by chat GUID or handle. The chat fields
(`primaryChatGuid`, `chatGuids`, `hasGroupPhoto`) are iMessage's and absent on another platform's row. A Slack
conversation is a DM (`im:D…`), a group DM (`mpim:G…`), a channel (`ch:C…`) or one **thread** inside any of them
(`th:<channel>:<root ts>`, kind `thread`), and keeps its channel and thread root under `slack`. A reply lives in its
thread's conversation and the thread's root in the DM, group DM or channel Comma holds it in (in the thread when Comma
holds none), whichever read brought it; a message stored elsewhere moves there. The root carries the thread's
`replyCount`. A thread is part of its channel or DM: the list shows it only while it wants Milad (owed a reply, marked
unread, pinned), and on desk it opens in a panel beside its channel or DM (`ThreadBeside`), on phone as its own screen.
Milad **follows** a thread in a DM or group DM, and one he started, replied in or is mentioned in (`slack.following`).
Convex reads Slack itself (`convex/comma/slackEvents.ts`, `slackSync.ts`): the Events webhook keeps every DM and group
DM message, a thread Milad follows, and everything in the channels on the account's `slackChannels`, which Settings
follows and unfollows (`convex/comma/slackChannels.ts`), and drops the rest before any write; a 90-day backfill (one
per channel followed later) and a 15-minute backstop cron write through the same idempotent ingest.
Each Slack user is a `slack` identity that joins the person with exactly its email, or else a person of its own. A Gmail
conversation is one thread (`t:<threadId>`, kind `emailThread`) with its subject, whether it is in the inbox, and whether
it is bulk under `gmail`; Convex reads the mailbox itself (`convex/comma/gmailPush.ts`, `gmailSync.ts`): a Pub/Sub push,
verified by Google's OIDC token, schedules a history sync from the stored historyId, a 5-minute backstop cron runs the same
sync, and a paged backfill reads the inbox and 90 days of threads where Milad wrote or a participant resolves to a person.
Each non-bulk sender is an `email` identity joined to the person who has exactly that address. Archived in Gmail is
settled in Comma; a backfill or resync settles quietly, without a clear in the log. Settling an email thread in Comma
queues an archive on the Gmail lane (unsettling, an unarchive); a confirmed one records the thread's inbox state, so
Gmail's echo changes nothing, and a refused one takes the move back and keeps Gmail's error on the thread
(`gmail.archiveError`) until the thread's next sync or settle. Email threads list in the Mail
workspace (`client/src/components/mail-workspace.tsx`, its own chunk), not in Messages: People holds threads
from someone who resolves to a person and is owed a reply, All inbox everything in the inbox, and the reader shows each
message as a card with the cleaned HTML in an iframe that runs no scripts and loads no remote content until Load images.
The reader's Reply and Reply all open the email composer (`client/src/components/email-composer.tsx`, in Mail's chunk)
with To, Cc and subject filled as Gmail fills them; Enter adds a line and ⌘Enter sends. An agent's draft for the thread
opens the composer with its text and note. Archive and Move to Inbox settle and unsettle.
Group CRM
(`chat_crm`, chat `tags`, chat `event_links`) belongs to the conversation.
Its **kind** is `dm`, `group`, `channel` or `emailThread` (`comma_conversations.kind`); iMessage ingest derives `dm` or
`group`, and `isGroup` (every kind but `dm`) is derived from it for older readers. Rows from before kinds read theirs
off `isGroup` (`conversationKind`) until the kinds backfill (`convex/comma/migrations.ts`) stamps them.
_Avoid_: chat (for the merged thread), chat GUID (as an app-level id)

**Handle**:
A participant's or sender's address, a bare string, and its kind: `phone`, `email` or `slack` (a `slack:` user id), named
as `identities.kind` names them. `parseHandle` in `shared/address.ts` is the one place that decides the kind, and each
kind's rules there say how it normalizes (the identity graph's `normalized`), how it matches another spelling (a phone's
last ten digits, an email lowercased), and how it shows (a Slack id shows as "Slack user" until a name resolves).
Identity lookup, conversation keys, person context, contact matching and display all go through it. Different kinds
never match.
_Avoid_: address type, raw handle (for the parsed form)

**Route**:
Where a command executes: a platform, an account, and that platform's thread id: for iMessage a chat GUID, for
Slack a channel and, in a thread, its root, for Gmail a thread id.
Enqueue stamps the conversation's primary chat on each outbox row; the bridge runs exactly the
stamped route and never picks one.
_Avoid_: send target, resolved chat

**Chat State**:
The pure rules for a chat's flags: how Unresponded/Waiting/Unread derive from its triage
state and last message, and which lens it matches. Convex computes flags with them and the
client filters with them.
_Avoid_: filter logic, flag logic

**Platform profile**:
What a platform's rules are and what a route can do, as data in `shared/platform-profile.ts`. Its **attention** reads a
conversation's last message as needs you, waiting or none, and Unresponded and Waiting are that attention until the
message is dismissed. Its **screening** says known, stranger, spam or bulk, which the type lens and Today's candidates use;
for iMessage, junk is spam and a participant who resolves to a named person makes the conversation known. Slack's
attention follows iMessage's in a DM, group DM or thread; a channel needs you only when its last message is someone
else's and mentions you (`mentionsMe` on the last message), and never waits; a thread Milad doesn't follow wants
nothing, and costs the list no read. Slack screens nothing: everyone in the
workspace is known. On Slack, Comma sends, replies in a thread, reacts (any number per sender), edits and deletes;
mentions, scheduling and attachments grey with "Not in Comma's Slack yet". Gmail's attention follows iMessage's; its
screening says bulk for mail sent to a list (a List-Unsubscribe or List-Id header, `Precedence: bulk`, `Auto-Submitted`,
a Promotions, Social, Updates or Forums label, or a no-reply sender), which stays out of People and Today. On Gmail,
Comma sends and replies; an email send carries its To, Cc and subject (`email` on the send), and Convex refuses one
with no recipients. Attachments and scheduling grey with "Not in Comma's Gmail yet", and reply suggestions stay off for
email. For routes,
each feature (reactions and which
tapbacks, reply, edit, unsend, typing, mentions, scheduling, calls, attachments, FaceTime links, group management,
deleting) lists the services that carry it, whether it exists only in a group, and whether BlueBubbles needs its
Private API for it. The profile also holds how a route draws (`platformBadge`: the label and dot colour every
service mark reads), the composer's per-route setup (`composerConfig`: placeholder, send colour, Enter-sends and the
"Send with" options) and the edit and unsend windows. Enqueue rejects a command its route can't run (`convex/comma/routeSupport.ts`), and the client
shows that control greyed with the same short reason ("SMS can't send reactions") instead of hiding it.
_Avoid_: capability flags, service checks (`service === "SMS"`)

**Account**:
One signed-in identity on a platform (`comma_accounts`): the iMessage Mac, a Slack workspace, or a Gmail mailbox. Conversations, chat aliases, messages, attachments, scheduled messages and sync cursors carry its `accountId`,
so a conversation key or a message id only needs to be unique within its account. The bridge names its account at
startup (`POST /comma/ingest/account`, seeded idempotently) and stamps it on every batch; a bridge that names none
writes for iMessage's. A snapshot (unread, scheduled) replaces only its own account's state. Where a platform reports no
from-me flag (`reportsFromMe` in `PLATFORM_IDENTITY`; iMessage reports one), a sender among the account's `selfHandles` is me. The
iMessage bridge names its handles at startup from chat.db's `chat.account_login`, the phone and email Messages signs in
with. An OAuth account (Slack's workspace, a Gmail mailbox) keeps its token on the row as `credentials`, AES-GCM sealed under the Convex
env `COMMA_TOKEN_KEY` and bound to the account (`convex/comma/credentials.ts`); only internal actions open it, and Settings'
`listAccounts` names its fields so the token never reaches a client. A mailbox seals Google's refresh token beside a
one-hour access token, which `gmailToken` refreshes in Convex; a refused refresh sets the account's health to
`needsAttention` and Settings shows Reconnect. Its `selfHandles` are the address and its send-as aliases. A message whose mention names one of them is **addressed to me** (`mentionsMe`, set at ingest). Rows from before accounts carry no `accountId` and count as
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
tapback's emoji, as `emoji:😍`; what a react command sends), an optional emoji, and the sender. Where the platform
profile says `oneReactionPerSender` (iMessage, as in Messages), a sender has one reaction per message: a new one
replaces theirs, whatever its kind; elsewhere each key stands alone. `comma_reactions` holds each
sender's newest state per message and key, removals included, so an older event arriving late never undoes a newer
one; a sender's replaced reactions stay as removals. Rows written before keys were namespaced read as `emoji:`, and
reads show only a sender's newest. Ingest turns an iMessage tapback into a reaction and stores no message row for it.
The tray offers the route's reaction set from its platform profile, and an emoji picker where the route has
`emojiReact`. Sending an emoji also needs the Mac's BlueBubbles to say it can (`custom_emoji_reactions` in its server
info, proposed upstream and absent through 1.9.12); the iMessage executor status carries it as `emojiReactions`, and
the picker greys with the reason until then. Others' Slack reactions arrive as `reaction_added` and `reaction_removed`
events, keyed by the emoji Comma offers under that Slack name (`slackNameEmoji`), so Milad's own echo matches the key
he sent; a name Comma has no emoji for shows as `:name:`.
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
The Mini's SQLite file (`OverlayDb`), shared by `comma:server` and `comma:ai`: bridge cursors and versions, AI caches, transcripts.
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
Web Lock. The bubble says "Waiting to send" at once when Convex or the route's executor is out of reach (its status row
missed three heartbeats), and after a second when the executor is up but has not taken it. Attachments and voice memos are not pending sends yet. See `shared/pending-send.ts`.
_Avoid_: temp message, optimistic send, local send

**Person summary**:
A short written read of one person across iMessage, Slack and email (`convex/comma/personSummaries.ts`,
`comma_person_summaries`). A fresh real message from someone who resolves to a person schedules a rebuild 30 minutes
later; a later message moves that time instead of adding one, so a burst rebuilds once. Channel chatter, a thread Milad
does not follow, bulk mail and history a backfill posts never do. The rebuild is a `personSummary` command on the
`aiBackground` lane: `comma:ai` reads the person's recent messages (`personSummaryContext`, channels left out), makes one
`claude-haiku-5-5` call at low effort (`server/ai/person-summary.ts`), and writes the answer (`personSummaryPublish`),
at most 100 a day. The agent pane heads a one-to-one conversation with the person, their platforms, the summary and
their open threads on every platform (`personSummaries.get`); the agent's session and Today's cards read the summary
beside the raw messages.

**Today's platforms**:
Today ranks every platform through the profile's attention and screening hooks (`todayCandidateState`): iMessage as
before, Needs you and Waiting; Slack when it needs Milad (a DM, group DM or followed thread owed a reply, a channel
mention), never Waiting, since a thread he answered last would take most of the Waiting reads; email only as Mail's People
lens, a known sender owed a reply, never bulk. `todayCandidates` drops a row on its flags before projecting it. The
client ranks the People threads among the newest 50 inbox threads beside the Messages directory, and an email row opens
the Mail reader in the thread pane (on a phone, the Mail tab).

**Outbox lane**:
The executor a queued command waits for, stamped on its `comma_outbox` row at enqueue from the route's
platform and the command's kind: one lane per messaging platform (`imessage`; `slack`, a convex lane that
calls Slack's Web API as Milad, `convex/comma/slackLane.ts`; `gmail`, a convex lane that sends, archives and unarchives
through the Gmail API, `convex/comma/gmailLane.ts`), an `ai` lane
for suggestions, identify, suggestion feedback, clearing learning and transcription, and an `aiBackground`
lane for suggestion precompute and person summaries, which nobody waits on. The lane registry
(`convex/comma/laneRegistry.ts`) says who runs each: a **pull** lane waits for an outside executor to
claim it (the Mini's `comma:server` for `imessage`, its `comma:ai` for both model lanes); a **convex** lane runs in a
Convex action that enqueue schedules, which claims under the same lease and whose lease expiry schedules
the next drive. A convex lane's thrown error leaves its command `unknown`, because the platform may have acted;
only a `NotSentError` (refused, or never sent) fails it. A Slack send that ends unknown is looked for in Slack's history at
20 seconds and 2 minutes, by the clientKey in its message metadata or by Milad's id and exact text, and lands as sent
when found; it is never posted again. A Gmail send goes out as RFC 822 with the replied message's Message-ID as
In-Reply-To and References and the thread's id, so it threads in Gmail, and with its own Message-ID built from the
clientKey; unknown, it is looked for at the same times by that Message-ID (`rfc822msgid:`), then as a Sent message in
the thread with the same subject and text, and is never sent again. Every lane runs one command at a time, so a slow model
call never holds back a send.
What a confirmed command changes in Convex beyond its receipt is the lane's `onResult`. AI work reads the
conversation from Convex by conversation id, never from BlueBubbles. Convex queues a reply-suggestion
precompute on a fresh inbound message in a known DM while the AI process's heartbeat is fresh; the AI process
drops one that waited more than two minutes and caps them at 150 a day. The lease, claim token, retry policy and receipts are
shared by every lane.
_Avoid_: queue (when meaning one lane), worker

**Executor status**:
Each executor's connection in `comma_bridge_state`, keyed `<platform>:<accountId>` (the Mini's bridge
for the iMessage account) or `ai` (the AI process): `connected`, `lastSeenAt`, an optional `detail`, and
its own capabilities (BlueBubbles' Private API and emoji reactions; suggestions and Whisper). A client
reads the row for the conversation's route (`shared/executors.ts`), so a conversation greys controls and
waits on the heartbeat of the executor that runs its commands, and names it ("Check the Mac mini
connection"). The single `mini` row from before is retired: a publish in that shape lands in both rows.
_Avoid_: bridge state (for the per-executor row), Mini status

**Unresponded**:
A chat its platform's attention says needs you; for iMessage, its last message is inbound and you owe a reply. Dismissable until the next
inbound message; mutable per chat.

**Waiting**:
A chat its platform's attention says is waiting; for iMessage, its last message is yours and you're waiting on them. Dismissable until the
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
