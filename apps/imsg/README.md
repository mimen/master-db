# imsg

Self-hosted iMessage web client backed by a [BlueBubbles](https://bluebubbles.app) server.
Runs on the Mac Mini, reachable on the tailnet only. Responsive PWA: split-pane on
desktop, list→thread on mobile.

## Features

- Read + reply (text and attachments), inline media, contact-name resolution
- Reactions, threaded replies, mark-read, new-chat compose — require the BlueBubbles
  **Private API** (`private_api: false` degrades these gracefully)
- Filters: Unread / Unresponded / Waiting-on-them / Archived × All / DMs / Groups / Unknown
- Unknown contacts and Apple-flagged junk stay out of the default inbox and remain available under Unknown
- Unresponded = last message inbound; Waiting = last message yours; one-tap dismiss
  clears a chat from either until the next message flips its state
- Archive is app-local (SQLite overlay), auto-unarchives on new inbound
- Realtime via BlueBubbles socket.io → SSE fanout
- Global message search (scans recent history server-side)

## Architecture

```
Expo/React-Native-Web app  ←SSE + JSON→  Bun/Hono server  ←REST + socket.io→  BlueBubbles (localhost:1234)
                                        └─ bun:sqlite overlay (archive flags, dismissals)
```

- `server/` — Hono app, BlueBubbles client, overlay DB, filter logic
- `shared/types.ts` — normalized API types used by both sides
- `client/` — Expo app (universal: web export served by the server, native-capable)

## Run

```sh
bun install
cp .env.example .env   # set BB_PASSWORD
bun run build          # exports the Expo web app to client/dist/
bun start              # serves app + API on :8377
```

Dev: `bun run dev:server` for the API; `cd client && bun run start` for the Expo dev server
(native builds reach the Mini over the tailnet; the web app is re-exported with `bun run build`).

## Env

| var | default | |
|---|---|---|
| `BB_URL` | `http://localhost:1234` | BlueBubbles server |
| `BB_PASSWORD` | — | required |
| `PORT` | `8377` | |
| `DB_PATH` | `imsg.db` | overlay SQLite |
