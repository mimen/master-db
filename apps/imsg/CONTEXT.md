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
