# Beeper Integration

Mirror of Milad's Beeper Desktop message history into Convex for searchable, durable backup across all bridged networks (WhatsApp, Telegram, iMessage, Slack, Google Messages, Matrix).

Built as the second-class citizen alongside the Todoist integration. Same general shape (schema/queries/mutations/sync/types) with one major difference: **the source of truth (Beeper Desktop) is local-only**, so ingest is pushed from a local script rather than pulled by a Convex action.

## Pipeline

```
Beeper Desktop (localhost:23373) ──┐
                                   │  (1) HTTP GET — list chats, list messages
                                   ▼
scripts/sync-beeper.ts (on Milad's Mac, Bun)
                                   │  (2) HTTP POST — batched payloads
                                   ▼
POST /beeper/ingest (Convex httpAction)
                                   │  (3) ctx.runMutation(...)
                                   ▼
beeper.internalMutations.{upsertAccount, upsertChat, upsertMessages, markAccountSynced}
                                   │
                                   ▼
beeper_accounts / beeper_chats / beeper_messages
```

## Tables

| Table              | Identity              | Notes |
| ------------------ | --------------------- | ----- |
| `beeper_accounts`  | `account_id`          | One row per Beeper-connected network |
| `beeper_chats`     | `chat_id`             | Beeper/Matrix room id, globally unique |
| `beeper_messages`  | `(chat_id, msg_id)`   | Beeper message ids are only chat-local |

`beeper_messages` has a `searchIndex` on `text` with filters on `chat_id`, `network`, `sender_id`, `is_sender`, `type`.

Attachments are stored inline on each message row as `attachments: { mxc_id, mime_type, file_name, beeper_src_url, convex_storage_id?, ... }[]`. Phase A stores everything except `convex_storage_id`; Phase B (separate task) uploads bytes to Convex File Storage and patches that field in place using `mxc_id` as the dedupe key across chats.

## Auth

`POST /beeper/ingest` requires `Authorization: Bearer <BEEPER_INGEST_SECRET>`. The same value lives in:

- Convex env: `BEEPER_INGEST_SECRET` (set via `bunx convex env set`)
- Local `.env.local` for the sync script

If the env var is unset on the deployment, the endpoint returns 500 with a clear error — fail closed, never accept writes.

## Running

```bash
# One-time prep: set the shared secret on the deployment
bunx convex env set BEEPER_INGEST_SECRET "$(openssl rand -hex 32)"

# Local .env.local needs (alongside CONVEX_URL etc.):
#   BEEPER_URL=http://localhost:23373/v1
#   BEEPER_ACCESS_TOKEN=...                                 # from Beeper Desktop > Developers
#   CONVEX_INGEST_URL=https://<deployment>.convex.site/beeper/ingest
#   BEEPER_INGEST_SECRET=<same as the one above>

# Smoke test (5 chats only, no Convex writes)
bun run scripts/sync-beeper.ts --limit-chats 5 --dry-run

# Smoke test (5 chats, real writes)
bun run scripts/sync-beeper.ts --limit-chats 5

# Full WhatsApp backfill (resumable)
bun run scripts/sync-beeper.ts
```

Progress is tracked per-account in `scripts/.beeper-sync-progress.json`. Re-running skips already-completed chats; pass `--refresh` to re-fetch everything.

## Common Queries

```bash
# Sync health across all networks
bunx convex run beeper:queries.getSyncStatus.getSyncStatus

# Recent chats (any network)
bunx convex run beeper:queries.getRecentChats.getRecentChats '{"limit": 20}'

# Recent chats (WhatsApp only)
bunx convex run beeper:queries.getRecentChats.getRecentChats '{"network": "WhatsApp", "limit": 20}'

# Messages for a specific chat
bunx convex run beeper:queries.getMessagesByChat.getMessagesByChat '{"chat_id": "!9iCfip38rzlgcROX7VP3:beeper.local"}'

# Full-text search
bunx convex run beeper:queries.searchMessages.searchMessages '{"query": "umbrella weekend", "network": "WhatsApp"}'
```

## Why local-push instead of Convex-pull

Beeper's API only exists at `localhost:23373` on Milad's machines. Convex actions run in a Convex-hosted runtime that cannot reach Milad's localhost. So ingest has to originate on a machine that has both:

1. A logged-in Beeper Desktop with the API enabled.
2. Network access to the Convex deployment.

That's the laptop or Mac Mini running `bun run scripts/sync-beeper.ts`. Real-time updates (Phase C, not yet built) will use Beeper's WebSocket subscription (`ws://localhost:23373/v1/ws`) on the same local script, streaming `message.upserted` events into the same ingest endpoint.

## Phase plan

- **Phase A** (this directory, shipped): Schema + ingest + local script + sync of chats/messages metadata.
- **Phase B** (next): Upload referenced attachments (~29 GB across all networks) to Convex File Storage. Adds dedup by `mxc_id`, a `generateUploadUrl` mutation, and a parallel/resumable uploader.
- **Phase C** (later): Long-running WS subscriber for realtime updates, run via launchd on the Mac Mini.
- **Phase D** (later): Other networks (`--account telegram`, `--account local-telegram_...`, `slackgo.*`, etc.) — same script, no schema changes needed.
