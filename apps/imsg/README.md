# imsg

Self-hosted iMessage web client backed by a [BlueBubbles](https://bluebubbles.app) server.
Runs on the Mac Mini, reachable on the tailnet only. Responsive PWA: split-pane on
desktop, list→thread on mobile.

## Features

- Read + reply (text and attachments), inline media, contact-name resolution
- Reactions, threaded replies, mark-read, new-chat compose — require the BlueBubbles
  **Private API** (`private_api: false` degrades these gracefully)
- Filters: Unread / Unresponded / Waiting-on-them / Archived × All / DMs / Groups
- Unresponded = last message inbound; Waiting = last message yours; one-tap dismiss
  clears a chat from either until the next message flips its state
- Archive is app-local (SQLite overlay), auto-unarchives on new inbound
- Realtime via BlueBubbles socket.io → SSE fanout
- Global message search (scans recent history server-side)

## Architecture

```
Vite/React/shadcn SPA  ←SSE + JSON→  Bun/Hono server  ←REST + socket.io→  BlueBubbles (localhost:1234)
                                        └─ bun:sqlite overlay (archive flags, dismissals)
```

- `server/` — Hono app, BlueBubbles client, overlay DB, filter logic
- `shared/types.ts` — normalized API types used by both sides
- `src/` — React app

## Run

```sh
bun install
cp .env.example .env   # set BB_PASSWORD
bun run build          # builds SPA to dist/
bun start              # serves app + API on :8377
```

Dev: `bun run dev:server` + `bun run dev` (Vite proxies /api and /events to :8377).

## Env

| var | default | |
|---|---|---|
| `BB_URL` | `http://localhost:1234` | BlueBubbles server |
| `BB_PASSWORD` | — | required |
| `PORT` | `8377` | |
| `DB_PATH` | `imsg.db` | overlay SQLite |
