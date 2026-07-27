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
cp .env.example .env                 # set server values, including BB_PASSWORD
cp client/.env.example client/.env   # set both required Expo public values
bun run build                        # exports the Expo web app to client/dist/
bun start                            # serves app + API on :8377
```

Dev: `bun run dev:server` for the API; `cd client && bun run start` for the Expo dev server
(native builds reach the Mini over the tailnet; the web app is re-exported with `bun run build`).

## Render (visual QA)

```sh
bun run render          # PNGs + a self-contained contact sheet in render/out/
bun run render --build  # force a client re-export first
```

Boots a throwaway server on an **invented** Chat Directory, drives it through both
layouts headlessly, and writes one PNG per capture plus `render/out/index.html`.

- Two fixed viewports, because this is one app with two layouts: **1440×900** (split
  pane) and **390×844** (list, then thread). Not a responsive sweep.
- Every capture walks the four state lenses — Unread, Unresponded, Waiting, Archived —
  plus the filter surface (desktop popover, mobile sheet) and an open thread in each layout.
- **No real conversation data, ever.** `IMSG_FIXTURE=1` swaps the BlueBubbles seam for
  the in-memory fake loaded from `server/render-fixture.ts`; every name, number, and
  message there is fabricated. The render server runs on its own port with its own
  temp Overlay DB and a scratch `HOME`, cannot reach a BlueBubbles instance, and never
  touches the service running on the Mini.

`render/out/` is gitignored — the captures are evidence for a review, not a committed
baseline.

## Env

| var | default | |
|---|---|---|
| `BB_URL` | `http://localhost:1234` | BlueBubbles server |
| `BB_PASSWORD` | — | required |
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
