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

- **Phase A** (shipped): Schema + ingest + local script + sync of chats/messages metadata.
- **Phase B** (shipped): Upload referenced attachments to Convex File Storage. Dedupes by Matrix `mxc_id` so a media file shared across many messages (forwards, group blasts) is uploaded once.
- **Phase C** (later): Long-running WS subscriber for realtime updates, run via launchd on the Mac Mini.
- **Phase D** (later): Other networks (`--account telegram`, `--account local-telegram_...`, `slackgo.*`, etc.) — same scripts, no schema changes needed.

## Phase B — attachment pipeline

Beeper Desktop caches every attachment locally under `~/Library/Application Support/BeeperTexts/media/<homeserver>/<key>`. Each message we ingest in Phase A carries a `mxc_id` per attachment that points back into that cache. Phase B walks every chat once, collects every unique `mxc_id`, and uploads the referenced bytes into Convex File Storage.

Three HTTP routes are added (all share the same `BEEPER_INGEST_SECRET` bearer auth as `/beeper/ingest`):

| Route                              | Body                            | Purpose |
| ---------------------------------- | ------------------------------- | ------- |
| `POST /beeper/attachments/discover`  | `{ mxc_ids: string[] }`         | Partition into already-uploaded vs missing — drives resumability. |
| `POST /beeper/attachments/uploadUrl` | `{}`                            | Returns a short-lived single-use URL the uploader POSTs file bytes to. |
| `POST /beeper/attachments/record`    | `{ mxc_id, convex_storage_id, network, mime_type?, ... }` | Persists the mapping in `beeper_attachments`. |

The new `beeper_attachments` table is the single source of truth for "where are the bytes" — `beeper_messages.attachments[].convex_storage_id` is intentionally left unpopulated so the messages table stays immutable post-Phase-A. Reads join through `getAttachmentUrl(mxc_id)`.

### Running the Phase B uploader

```bash
cd ~/Programming/Repos/convex-db
eval "$(op read 'op://Sol/Beeper Env/notesPlain')"
source <(grep -E '^(BEEPER_URL|BEEPER_INGEST_SECRET)=' .env.local)
export CONVEX_INGEST_URL="https://blessed-egret-906.convex.site/beeper/ingest"

bun run scripts/upload-beeper-attachments.ts --limit 10 --dry-run   # smoke test
bun run scripts/upload-beeper-attachments.ts                        # full WhatsApp
bun run scripts/upload-beeper-attachments.ts --account gmessages    # later networks
```

Progress lives at `scripts/.beeper-attachments-progress.json`: per-account map of `mxc_id → convex_storage_id` plus a `failed` map of `mxc_id → last error`. Re-runs ask Convex's `/discover` endpoint up front so already-uploaded files are skipped without any local state.

### Resolving an attachment

```bash
bunx convex run beeper/queries/getAttachmentUrl:getAttachmentUrl \
  '{"mxc_id":"mxc://local.beeper.com/...xxx"}'
# → { mxc_id, convex_storage_id, url, mime_type, file_name, file_size }
```

`url` is a short-lived signed URL from `ctx.storage.getUrl(...)`; refetch on every render rather than persist it.
