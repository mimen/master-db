# Agentic Engine

HTTP server wrapping the Claude Agent SDK for async, durable, multi-entity agentic decision-making runs.

Design: [docs/superpowers/specs/2026-05-15-agentic-engine-web-server-design.md](../docs/superpowers/specs/2026-05-15-agentic-engine-web-server-design.md)
Plan:   [docs/superpowers/plans/2026-05-15-agentic-engine-web-server-implementation.md](../docs/superpowers/plans/2026-05-15-agentic-engine-web-server-implementation.md)

## Endpoints

All routes except `GET /healthz` require `Authorization: Bearer <AGENTIC_SERVER_TOKEN>`.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/run` | Enqueue a discovery or follow-up turn for an entity. Async — returns immediately. |
| `POST` | `/run/:entity_ref/wait` | Long-poll variant; blocks until terminal message or timeout. |
| `GET`  | `/run/:entity_ref` | Cached read of the last proposal + run status. |
| `GET`  | `/run/:entity_ref/status` | Minimal status payload + busy flag + turn count. |
| `POST` | `/run/:entity_ref/interrupt` | Cancel in-flight work for an entity. |
| `GET`  | `/healthz` | Process uptime, in-flight count, last error. |

## Run locally

```bash
AGENTIC_SERVER_TOKEN=$(op read op://Sol/agentic-engine/server_token) \
CONVEX_URL=$(op read op://Sol/agentic-engine/convex_url) \
bun --cwd engine start
```

## Install as a launchd service (Mac mini)

```bash
chmod +x engine/deploy/start-with-secrets.sh
cp engine/deploy/com.milad.agentic-engine.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.milad.agentic-engine.plist
launchctl start com.milad.agentic-engine
tail -f ~/.agentic-engine/launchd.err.log
```

Verify the service is up:
```bash
curl http://localhost:8787/healthz
```

## Cloudflare Tunnel

The engine accepts requests on `localhost:8787` and is exposed publicly via Cloudflare Tunnel. Copy `engine/deploy/cloudflared.yml.example` to your `~/.cloudflared/config.yml`, replace the tunnel uuid and hostname, then run `cloudflared` (typically also as a separate launchd agent).

## 1Password references

- `op://Sol/agentic-engine/server_token` — shared bearer token used by clients.
- `op://Sol/agentic-engine/convex_url` — production Convex deployment URL.

## Tech stack

Bun + Hono + Convex client + Claude Agent SDK + zod + lru-cache + ulid.

Tests: vitest. Run from repo root: `bunx vitest run`.
