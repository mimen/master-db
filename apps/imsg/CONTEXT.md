# imsg

Self-hosted iMessage web client: an Expo/React-Native-Web app talking to a Bun/Hono
server that fronts a BlueBubbles instance, with an app-local SQLite overlay for state
Apple doesn't track (archive, dismissals, pins).

## Language

**Chat Directory**:
The always-fresh, flag-annotated list of chat summaries the server maintains — BlueBubbles
data merged with the Overlay, unread counts, and the mark-read override.
_Avoid_: chat list cache, summaries cache

**Chat State**:
The pure rules for a chat's flags — how Unresponded/Waiting/Unread/Archived are derived
and how a new message flips them. Shared verbatim by server and client.
_Avoid_: filter logic, flag logic

**Overlay**:
App-local per-chat state stored in SQLite that BlueBubbles knows nothing about:
archived-at, dismissal GUIDs, mute, pin, marked-unread.
_Avoid_: overlay DB rows (when meaning the concept), local state

**Unresponded**:
A chat whose last message is inbound — you owe a reply. Dismissable until the next
inbound message; mutable per chat.

**Waiting**:
A chat whose last message is yours — you're waiting on them. Dismissable until the
next message flips the state.

**Archived**:
Overlay-only flag; lazily self-clearing — a new inbound message newer than the archive
timestamp auto-unarchives.

**BlueBubbles seam**:
The single interface to BlueBubbles — REST operations plus the inbound event stream.
Two adapters: the HTTP/socket.io client in production, an in-memory fake in tests.
_Avoid_: BB client (when meaning the seam), API wrapper

**SSE fast path**:
Applying a message we already know about directly to the Chat Directory and client
store ahead of BlueBubbles' own DB catching up; the next full rebuild reconciles.
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
