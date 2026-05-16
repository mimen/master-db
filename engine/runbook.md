# Agentic Engine — Runbook

Operational reference for the engine running on Milad's Mac mini. For *what it is* and *why*, see the vault: `Services/Agentic Engine.md`. For *how it was built*, see `docs/superpowers/specs/` and `docs/superpowers/plans/`.

This file captures **operational truth** — state that drifts and needs updating as the deploy evolves.

## Current deployment state (as of 2026-05-15)

| Layer | Status | Notes |
|---|---|---|
| Engine code | ✅ on `main` | `engine/` package + `convex/agentic/*` |
| Convex tables | ✅ deployed | `shiny-gerbil-853` (master-db dev deployment) |
| Engine process | ⚠️ ad-hoc | Run interactively via `bun --cwd engine start`. Not yet daemonized. |
| launchd plist | 🔲 not installed | `engine/deploy/com.milad.agentic-engine.plist` exists; not copied to `~/Library/LaunchAgents/`. |
| Cloudflare Tunnel | 🔲 not configured | Engine only reachable on `localhost:8787`. Public HTTPS pending. |
| Secrets in 1Password | 🔲 not provisioned | `op://Sol/agentic-engine/server_token` does NOT exist yet. Token currently lives in `/tmp/agentic-smoke.env` (volatile). |
| Convex Auth | 🔲 not configured | Convex queries are publicly callable. Separate workstream. |
| UX | 🔲 in progress (parallel branch) | `agentic-engine-ux` branch. |

## Smoke verified end-to-end (2026-05-15)

- Discovery → grounded proposal: ✅ tested on `todoist:task:6cWfQ846cHxr77jv` ("Automated artist email system"). Agent grepped repos, found existing implementation, identified real gaps with line numbers.
- EXECUTE write path: ✅ same task. `EXECUTE: rewrite_as_real_gaps` rewrote the Todoist task content + description via the agent's `todoist` skill. Verified via incremental sync.

## Start the engine (interactive)

```bash
cd ~/Documents/GitHub/master-db

# Provision token (one time — replace with proper 1Password item once that's set up)
export AGENTIC_SERVER_TOKEN=$(openssl rand -hex 24)
export CONVEX_URL=https://shiny-gerbil-853.convex.cloud
export LOG_DIR=$HOME/.agentic-engine/logs
mkdir -p "$LOG_DIR"

# Start
bun --cwd engine start
```

Engine boots on `:8787`. Expected first line: `{"ts":...,"level":"info","msg":"agentic-engine.boot","port":8787,"log_dir":"..."}`.

## Stop the engine

```bash
lsof -ti :8787 | xargs -r kill
```

## Health check

```bash
curl -s http://localhost:8787/healthz | jq
```

Expected:
```json
{"ok":true,"uptime_ms":...,"inflight":0,"last_error":null,"convex_ok":true}
```

## Trigger a discovery run

```bash
TOK=$AGENTIC_SERVER_TOKEN   # or: TOK=$(op read op://Sol/agentic-engine/server_token) once provisioned
TASK_ID=<a-todoist-id>

curl -s -X POST http://localhost:8787/run \
  -H "Authorization: Bearer $TOK" \
  -H "content-type: application/json" \
  -d "{\"entity_ref\":\"todoist:task:$TASK_ID\"}" | jq
```

Returns immediately with `{run_id, status: "discovering", accepted: true}`.

Watch progress in Convex:

```bash
bunx convex run 'agentic/queries/getRun:default' "{\"entity_ref\":\"todoist:task:$TASK_ID\"}"
```

Cycles `discovering → awaiting_decision` (or `error`) in 30–120s depending on tool calls.

Read the proposal once awaiting_decision:

```bash
bunx convex run 'agentic/queries/getThread:default' "{\"entity_ref\":\"todoist:task:$TASK_ID\"}" \
  | jq '[.[] | select(.kind == "proposal")] | last | .proposal_json'
```

## Execute a proposal option

```bash
curl -s -X POST http://localhost:8787/run \
  -H "Authorization: Bearer $TOK" \
  -H "content-type: application/json" \
  -d "{\"entity_ref\":\"todoist:task:$TASK_ID\",\"message\":\"EXECUTE: <option_id>\"}" | jq
```

## Debug a failing turn

1. **Convex error message:**
   ```bash
   bunx convex run 'agentic/queries/getThread:default' "{\"entity_ref\":\"$REF\"}" \
     | jq '[.[] | select(.kind == "error")] | last | .error_json'
   ```

2. **NDJSON shadow log** for the same entity — every raw SDK event:
   ```bash
   tail -100 ~/.agentic-engine/logs/$(echo "$REF" | tr ':' '_').ndjson | jq
   ```

3. **Engine stdout** — every spawn/resume + lastError captured. If using launchd: `~/.agentic-engine/launchd.err.log`.

## Common errors

| Symptom | Cause | Fix |
|---|---|---|
| `No conversation found with session ID: ...` | The runner's `cwd` changed since the session was created. Sessions are keyed by Claude Code's project hash. | Delete the `agenticRuns` row for that entity (forces fresh session) OR revert the runner config. |
| `agent terminated with error_during_execution` | SDK-internal error. Check NDJSON for the underlying message. | Usually a transient model failure — retry. |
| `no terminal event and no parseable proposal in transcript` | Agent emitted a `<proposal>...</proposal>` block but it didn't validate against `ProposalSchema`. Usually an invented `kind` or missing field. | Tighten the system prompt, or update `DEFAULT_SYSTEM` in `engine/src/runner/claudeSdkRunner.ts`. |
| Convex codegen fails with TS2589 | Stale generated types from before `staticApi` mode. | `bunx convex dev --once --typecheck=disable` (then re-run normally). |

## Rotate the server token

Once 1Password item is provisioned:

```bash
# Generate new
NEW=$(openssl rand -hex 24)
# Update 1Password
op item edit agentic-engine server_token="$NEW" --vault=Sol
# Restart engine (it reads on boot)
launchctl stop com.milad.agentic-engine
launchctl start com.milad.agentic-engine
```

## Install as launchd (when ready to daemonize)

```bash
chmod +x engine/deploy/start-with-secrets.sh
cp engine/deploy/com.milad.agentic-engine.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.milad.agentic-engine.plist
launchctl start com.milad.agentic-engine
tail -f ~/.agentic-engine/launchd.err.log
```

The plist points at `start-with-secrets.sh`, which reads `AGENTIC_SERVER_TOKEN` + `CONVEX_URL` from 1Password before exec'ing `bun start`. Provision those op items first or the script will fail.

## Set up Cloudflare Tunnel (when ready for public exposure)

Reminder: **do not expose publicly until Convex Auth is set up.** Today the bearer token gates the engine, but Convex itself remains open — the public Convex URL bypasses the engine entirely.

See `engine/deploy/cloudflared.yml.example` for the ingress shape.

## Deploy code changes

```bash
# On any machine
git checkout main
git pull
# Optional: bun install in root and engine
bun install
bun --cwd engine install
# Restart on the Mac mini (if daemonized)
launchctl kickstart -k gui/$(id -u)/com.milad.agentic-engine
```

The engine has no migration step. Convex schema changes auto-deploy via `bunx convex dev` / `bunx convex deploy`.

## Logs & forensics

- **Per-entity NDJSON** (every SDK event mirrored): `~/.agentic-engine/logs/<sanitized_entity_ref>.ndjson`.
- **launchd stdout/stderr** (when daemonized): `~/.agentic-engine/launchd.out.log`, `~/.agentic-engine/launchd.err.log`.
- **Convex projections** (the human-readable thread): `agentic/queries/getThread` and `agentic/queries/getActivities`.

NDJSON files are append-only and never pruned by the engine. Rotate manually if disk fills.

## Costs

Each discovery turn: ~$0.05–$0.25 in Anthropic API. Token usage per row stamped in `agenticThreadMessages.token_usage`. Sum across an entity for total spend:

```bash
bunx convex run 'agentic/queries/getThread:default' "{\"entity_ref\":\"$REF\"}" \
  | jq '[.[] | .token_usage // {} | (.input // 0) + (.output // 0)] | add'
```
