# imsg

Self-hosted iMessage web client backed by a [BlueBubbles](https://bluebubbles.app) server.
Runs on the Mac Mini. The Bun server binds to loopback, and Tailscale Serve exposes it to the tailnet at `https://milads-mac-mini.taild31e9a.ts.net:8447`. Responsive PWA: split-pane on desktop, list→thread on mobile.

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
cp .env.example .env                 # set server values, including BB_PASSWORD
cp client/.env.example client/.env   # set both required Expo public values
bun run build                        # exports the Expo web app to client/dist/
bun start                            # serves app + API on 127.0.0.1:8377
```

Dev: `bun run dev:server` for the API; `cd client && bun run start` for the Expo dev server
(native builds reach the Mini over the tailnet; the web app is re-exported with `bun run build`).

## Env

| var | default | |
|---|---|---|
| `BB_URL` | `http://localhost:1234` | BlueBubbles server |
| `BB_PASSWORD` | — | required |
| `HOST` | `127.0.0.1` | Keep loopback-only; remote access goes through Tailscale Serve |
| `PORT` | `8377` | |
| `DB_PATH` | `imsg.db` | overlay SQLite |
| `CONVEX_CLOUD_URL` | — | optional identity mirror and CRM deployment URL |
| `IMSG_IDENTITY_KEY` | — | shared identity gate; must match Convex and `client/.env` |
| `WHISPER_BINARY_PATH` | — | optional local `whisper-cli` binary |
| `WHISPER_MODEL_PATH` | — | optional local multilingual ggml model |
| `WHISPER_WORK_DIR` | `.cache/whisper` | ephemeral conversion files |

The Expo client reads a separate `client/.env` when exporting web or starting Metro:

| var | default | |
|---|---|---|
| `EXPO_PUBLIC_CONVEX_URL` | — | required absolute HTTP(S) Convex deployment URL |
| `EXPO_PUBLIC_IMSG_IDENTITY_KEY` | — | required; must match the Convex deployment's `IMSG_IDENTITY_KEY` |

Both client values are embedded in the bundle. The identity key is a coarse shared gate,
not a confidential browser secret. Builds fail before export when either value is absent.

## Network boundary

The API has no application-level authentication. Keep `HOST=127.0.0.1` and expose it only through Tailscale Serve:

```sh
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --yes --https=8447 http://127.0.0.1:8377
```

Clients use `https://milads-mac-mini.taild31e9a.ts.net:8447`. Port 8377 must not listen on LAN or tailnet interfaces.
