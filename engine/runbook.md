# Agentic Engine — Runbook

Operational reference for the engine running on Milad's Mac mini. For *what it is* and *why*, see the vault: `Services/Agentic Engine.md`. For *how it was built*, see `docs/superpowers/specs/` and `docs/superpowers/plans/`.

This file captures **operational truth** — state that drifts and needs updating as the deploy evolves.

## Current deployment state (as of 2026-05-20)

| Layer | Status | Notes |
|---|---|---|
| Engine code | ✅ on `main` | `engine/` package + `convex/agentic/*` |
| Convex tables | ✅ deployed | `shiny-gerbil-853` (master-db dev deployment) |
| Engine process | ✅ launchd | `com.milad.agentic-engine` LaunchAgent, `RunAtLoad` + `KeepAlive`. |
| launchd plist | ✅ installed | `~/Library/LaunchAgents/com.milad.agentic-engine.plist` (mode 600, `OP_SERVICE_ACCOUNT_TOKEN` baked into `EnvironmentVariables`). **If this key is missing/empty, `op read` falls back to the desktop-app integration and prompts on every restart** — the install step below guards against writing it empty. |
| Deployed engine | ✅ installed | Whole `engine/` package copied to `~/.agentic-engine/engine/` (incl. `node_modules`), outside `~/Documents` to bypass macOS TCC. The wrapper runs from `~/.agentic-engine/engine/deploy/start-with-secrets.sh`; its `--cwd …/..` resolves to `~/.agentic-engine/engine`. The repo copies under `engine/` are the source template. The standalone `~/.agentic-engine/start-with-secrets.sh` is vestigial (older single-file layout) and not what the plist runs. |
| Public ingress | ✅ Tailscale Funnel | `https://milads-mac-mini.taild31e9a.ts.net:10000` → `localhost:8787`. Bearer-gated. (Plan originally called for Cloudflare Tunnel; swapped to Funnel since Tailscale was already set up.) |
| Secrets in 1Password | ✅ provisioned | `op://Sol/agentic-engine/server_token` + `convex_url`. Service-account read at every restart. |
| Convex Auth | 🔲 not configured | Convex queries are publicly callable. Separate workstream (parallel agent). |
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

## Install as launchd

Already installed on the Mac mini. Below is the recipe to redo it on a new machine or after a wipe.

**Critical: the engine must live OUTSIDE `~/Documents/`.** macOS TCC blocks `launchd` from executing scripts under `~/Documents/` with `Operation not permitted` (no clear error path — symptom is silent failure or `bash: ...: Operation not permitted` in `launchd.err.log`). So the whole `engine/` package is deployed to `~/.agentic-engine/engine/`, and the plist runs the wrapper from there.

**Critical: `OP_SERVICE_ACCOUNT_TOKEN` must be present and non-empty before you install the plist.** launchd does NOT source `~/.zshrc`, so the token has to be baked into the plist's `EnvironmentVariables`. If it's missing/empty, every `op read` in the wrapper silently falls back to the 1Password **desktop-app integration**, which prompts for approval — and with `KeepAlive`, you get a prompt on every restart. The guard on step 0 fails loudly instead of writing an empty value.

```bash
# 0. GUARD: refuse to proceed if the service-account token isn't in this shell.
#    (Open a fresh interactive shell so ~/.zshrc has exported it.)
: "${OP_SERVICE_ACCOUNT_TOKEN:?Set OP_SERVICE_ACCOUNT_TOKEN before installing — launchd can't read ~/.zshrc, so an empty value here causes desktop-app prompts on every restart}"

# 1. Deploy the whole engine package to ~/.agentic-engine/engine/ (TCC-safe).
mkdir -p ~/.agentic-engine/logs
rsync -a --delete --exclude node_modules engine/ ~/.agentic-engine/engine/
( cd ~/.agentic-engine/engine && bun install --frozen-lockfile )

# 2. Install the plist (with OP_SERVICE_ACCOUNT_TOKEN injected — launchd
#    doesn't source ~/.zshrc). Heredoc delimiter is UNQUOTED so the token
#    and PATH expand here; step 0 guarantees the token is non-empty.
command cat > ~/Library/LaunchAgents/com.milad.agentic-engine.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>com.milad.agentic-engine</string>
    <key>ProgramArguments</key>
    <array>
      <string>/Users/mimen1994/.agentic-engine/engine/deploy/start-with-secrets.sh</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key><string>/Users/mimen1994/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
      <key>HOME</key><string>/Users/mimen1994</string>
      <key>LOG_DIR</key><string>/Users/mimen1994/.agentic-engine/logs</string>
      <key>OP_SERVICE_ACCOUNT_TOKEN</key><string>${OP_SERVICE_ACCOUNT_TOKEN}</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>/Users/mimen1994/.agentic-engine/launchd.out.log</string>
    <key>StandardErrorPath</key><string>/Users/mimen1994/.agentic-engine/launchd.err.log</string>
  </dict>
</plist>
PLIST
chmod 600 ~/Library/LaunchAgents/com.milad.agentic-engine.plist

# 3. VERIFY the token actually landed non-empty before loading (catches a stale
#    plist or an empty expansion — the exact drift that caused desktop prompts).
/usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:OP_SERVICE_ACCOUNT_TOKEN" \
  ~/Library/LaunchAgents/com.milad.agentic-engine.plist | command grep -q '^ops_' \
  && echo "✅ token baked in" \
  || { echo "❌ token missing/empty in plist — fix before loading"; exit 1; }

# 4. Load
launchctl load -w ~/Library/LaunchAgents/com.milad.agentic-engine.plist

# 5. Verify the running service uses the SERVICE_ACCOUNT (not desktop fallback)
launchctl print "gui/$(id -u)/com.milad.agentic-engine" | command grep -E "state|pid"
op whoami | command grep -E "User Type"   # expect: SERVICE_ACCOUNT
curl -s http://localhost:8787/healthz | jq -c
tail -f ~/.agentic-engine/launchd.err.log
```

The wrapper `~/.agentic-engine/engine/deploy/start-with-secrets.sh` reads `AGENTIC_SERVER_TOKEN` + `CONVEX_URL` from 1Password via `op read` before exec'ing `bun --cwd .../engine start`. Provision the 1Password item first (see "Provisioning 1Password items" below) or the script will exit at the first `op read`.

> To reload after an env/plist change on an already-installed machine, use `bootout` + `bootstrap` (plain `stop`/`start` does not re-read `EnvironmentVariables`):
> ```bash
> launchctl bootout gui/$(id -u)/com.milad.agentic-engine
> launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.milad.agentic-engine.plist
> ```

## Public ingress via Tailscale Funnel

Already up. Recipe to re-enable after a tailscale reset:

```bash
tailscale funnel --bg --https=10000 8787
tailscale funnel status   # confirm "Funnel on" for :10000
```

The engine is then reachable at `https://milads-mac-mini.taild31e9a.ts.net:10000`. Bearer-gated; the public URL alone gets you 401.

## Provisioning 1Password items

The default service-account token (in `OP_SERVICE_ACCOUNT_TOKEN`) is read-only. Use `env -u OP_SERVICE_ACCOUNT_TOKEN op item create ...` to fall back to user-auth (Touch ID). See the `1password` skill for the canonical pattern.

```bash
TOKEN=$(openssl rand -hex 24)
env -u OP_SERVICE_ACCOUNT_TOKEN op item create \
  --category=password --vault=Sol --title='agentic-engine' \
  "server_token=$TOKEN" \
  'convex_url=https://shiny-gerbil-853.convex.cloud'
```

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
