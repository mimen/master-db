# imsg (Comma)

Comma is Milad's messaging client for iMessage, Slack and Gmail. One list holds every conversation, one triage gesture settles it, and Mail has its own workspace.

Convex is the hub (`convex/comma`, tables in `convex/schema/comma`). Every client reads and sends through it, and Convex itself reads and sends Slack and Gmail. The Mac Mini runs the iMessage side and the model work. The Bun server binds to loopback, and Tailscale Serve exposes it to the tailnet at `https://milads-mac-mini.taild31e9a.ts.net:8447`.

The vocabulary (conversation, route, outbox lane, settle) is defined in [CONTEXT.md](CONTEXT.md). Agent rules and gotchas are in [AGENTS.md](AGENTS.md).

## Architecture

```
Expo app (web, iOS, desktop shell) ──Convex queries and mutations──▶ Convex (convex/comma)
                                                                    ├─ Slack Events webhook, sync and sends
                                                                    ├─ Gmail push, sync and sends
                                                                    └─ comma_outbox: commands, one lane per executor
Mini: comma:server ──bridge (COMMA_BRIDGE_SECRET)──▶ Convex
       ├─ BlueBubbles (localhost:1234) and chat.db: iMessage ingest, iMessage commands
       └─ session, release and health routes, plus the web app
Mini: comma:ai, comma:agent, comma:today ──▶ Convex and the AI gateway
```

- `server/index.ts` (launch agent `comma:server`) is the Hono app and the iMessage bridge (`server/bridge/`). It mirrors BlueBubbles and chat.db into Convex and runs the iMessage lane's commands. It serves the Convex session (`GET /api/convex-token`), release and deploy-status routes, `GET /api/health`, and the web export. The client makes no other REST call and opens no event stream to the Mini.
- `server/ai/main.ts` (`comma:ai`) runs the AI lanes: reply suggestions, person summaries, voice-memo transcription and the Today build, through the AI gateway.
- `server/agent/main.ts` (`comma:agent`) runs the agent pane's Claude Code sessions. It starts only with `COMMA_AGENT_ENABLED=1`.
- `server/today/trigger.ts` (`comma:today`) is the 7:00 AM job that asks for the day's Today build.
- `client/` is the Expo app: the web export the server serves, the iOS app, and the content of the Tauri desktop shell in `desktop/`.
- `shared/` holds types and rules both sides use, such as the platform profiles and executor keys.
- Launch agent templates are in `scripts/launchagents/`.

## Run

```sh
bun install --cwd ../.. && bun install && bun install --cwd client   # the root install supplies hoisted dependencies
cp .env.example .env                 # set server values, including BB_PASSWORD and COMMA_BRIDGE_SECRET
cp client/.env.example client/.env   # set EXPO_PUBLIC_CONVEX_URL
bun run build                        # exports the Expo web app to client/dist/
bun start                            # serves app + API on 127.0.0.1:8377
```

For browser UX iteration with Fast Refresh against production data:

```sh
bun run dev:web -- --data=real
```

The command is intentionally explicit because sends and conversation actions write to production. It derives and reserves a worktree-specific loopback port, verifies Metro is not reachable over LAN or tailnet, opens the browser, and keeps component state across most source edits. A fresh worktree must have `client/.env`; when it is missing, the launcher prints the exact command needed to copy the canonical file.

Branches with undeployed `server/` or `shared/` changes are rejected because the browser and production API could disagree. Use the scratch branch-preview path for server iteration. When the mismatch is understood and only UX behavior is under review, opt in explicitly with `bun run dev:web -- --data=real --allow-server-drift`.

Use `bun run dev:server` only for local API development. Native builds reach the Mini over the tailnet.

## Tests

```sh
bun test                    # the server, shared and client unit suites, in one process
bun run lint
cd ../.. && bunx vitest run convex/comma   # the Convex functions
bun run e2e:fixture         # the browser suite against the fixture world on 127.0.0.1:8399
```

The fixture suite builds a web export and serves it with a fake BlueBubbles and Convex (`e2e/fixture/`). It fails when its port is already taken, because another worktree's fixture server serves that worktree's build. Run on a free port with `IMSG_FIXTURE_PORT=8471 bun run e2e:fixture`. Set `IMSG_FIXTURE_REUSE=1` only to test against a fixture server you started yourself from this checkout. CI sets `IMSG_FIXTURE_PREBUILT=1` to serve the export its own step built.

## Env

The server processes read `apps/imsg/.env` (copy `.env.example`). It is gitignored; the Mini's copy holds the real values.

| var | default | |
|---|---|---|
| `BB_URL` | `http://localhost:1234` | BlueBubbles server |
| `BB_PASSWORD` | none | required by `comma:server` |
| `HOST` | `127.0.0.1` | must be loopback; remote access goes through Tailscale Serve |
| `PORT` | `8377` | |
| `DB_PATH` | `imsg.db` | overlay SQLite: bridge cursors, AI caches, transcripts |
| `CHATDB_PATH` | `~/Library/Messages/chat.db` | read-only, for unread counts, reconcile and the backfill |
| `CONVEX_CLOUD_URL` | none | Convex deployment URL; required by `comma:ai` and `comma:agent` |
| `CONVEX_SITE_URL` | none | Convex HTTP actions URL, where the bridge posts; required by `comma:ai` and `comma:agent` |
| `COMMA_BRIDGE_SECRET` | none | bearer for the bridge's Convex routes and the session the Mini mints; must match Convex's `COMMA_BRIDGE_SECRET`. Unset turns the bridge off |
| `IMSG_SERVER_SECRET` | none | identity key; must match Convex's `IMSG_SERVER_SECRET` |
| `APPLE_CONTACTS_INGEST_SECRET` | none | Apple Contacts sync into the identity graph; unset skips it |
| `AI_GATEWAY_URL` | `http://127.0.0.1:8317` | the AI gateway the AI lanes and the agent call |
| `AI_GATEWAY_KEY` | `~/.cli-proxy-api-key` | gateway key; `CLAUDE_GPT_GATEWAY_API_KEY` also works. Unset turns the AI surfaces off |
| `AI_FAST_MODEL` | `gpt-5.6-luna(low)` | model for quick AI work |
| `AI_VAULT_PATH` | `~/Documents/milad-vault` | vault root, read for the profile and contact candidates |
| `COMMA_AGENT_ENABLED` | off | `1` starts the agent pane's sessions |
| `COMMA_AGENT_ADDENDUM` | the vault's `ClaudeConfig/references/comma-agent.md` | instructions added to every agent session |
| `COMMA_AGENT_SCRATCH` | `~/.local/share/comma-agent` | the agent sessions' working directories |
| `AI_CCS_BIN` | `ccs` | the session catalogue CLI the agent registers sessions with |
| `WHISPER_BINARY_PATH` | none | optional local `whisper-cli` binary |
| `WHISPER_MODEL_PATH` | none | optional local multilingual ggml model |
| `WHISPER_WORK_DIR` | `.cache/whisper` | ephemeral conversion files |

The Expo client reads a separate `client/.env` when exporting web or starting Metro:

| var | default | |
|---|---|---|
| `EXPO_PUBLIC_CONVEX_URL` | none | required absolute HTTP(S) Convex deployment URL |

The value is embedded in the bundle, and the build fails before export when it is absent. The client signs in to Convex with the session it gets from `/api/convex-token`.

## Network boundary

The Mini's HTTP server has no application-level authentication. Keep `HOST=127.0.0.1` and expose it only through Tailscale Serve:

```sh
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --yes --https=8447 http://127.0.0.1:8377
```

Clients use `https://milads-mac-mini.taild31e9a.ts.net:8447`. Port 8377 must not listen on LAN or tailnet interfaces.
