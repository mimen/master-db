# Agentic Engine — Session Handoff (2026-05-16)

Snapshot of where the engine is at the end of the multi-day build session that
took it from spec to live-on-Mac-mini. Anyone (agent or human) picking this
project up next should read this first, then the roadmap, then the eval.

## Tonight, in one line

The engine is live, daemonized, publicly reachable behind Tailscale Funnel, gated by a 1Password-stored bearer; the React app is deployed on Heroku behind Convex Auth (Google OAuth, single-user allowlist); a parallel agent's UX work has landed roughly 35 productive conversations; we've evaluated the corpus and sequenced the next 5 iterations.

## Where to read next

1. **`docs/agentic-engine/2026-05-16-corpus-eval.md`** — what 35 conversations taught us about substance / surface / system. Read for the WHY behind the roadmap.
2. **`docs/agentic-engine/2026-05-16-roadmap.md`** — the next 5 iterations, sequenced with rationale. Read for WHAT to do next.
3. **`engine/runbook.md`** — operational state, start/stop/debug recipes, known limits.
4. **`docs/superpowers/specs/2026-05-15-agentic-engine-web-server-design.md`** — original design spec; only re-read if making architectural changes.
5. **`~/Documents/milad-vault/Services/Agentic Engine.md`** — vault entity (lives in Obsidian, syncs separately from this repo).

## Operational state (as of end-of-session)

| Thing | State | Where |
|---|---|---|
| Engine process | Running under `launchctl` agent `com.milad.agentic-engine` (KeepAlive + RunAtLoad) | Mac mini, port 8787 local |
| Wrapper script | `~/.agentic-engine/start-with-secrets.sh` (outside `~/Documents/` to bypass macOS TCC) | Mac mini |
| Public URL | `https://milads-mac-mini.taild31e9a.ts.net:10000` | Tailscale Funnel, port 10000 |
| 1Password item | `op://Sol/agentic-engine/{server_token,convex_url}` (`API_CREDENTIAL` category, user-auth-created via Touch ID) | Sol vault |
| Convex deployment | Single deployment `shiny-gerbil-853` (master-db dev) | both localhost AND Heroku point here |
| Heroku app | `convex-db-master` at `convex-db-master-d31d50f579b2.herokuapp.com` (note the suffix; the bare URL 404s) | production-style instance |
| Convex Auth | Google OAuth, single-user allowlist (`milad@afternoonumbrellafriends.com`), multi-origin redirect callback supporting both localhost:3000 and Heroku | wired this session |
| Forensic logs | `~/.agentic-engine/logs/<entity_ref>.ndjson` per entity, append-only | Mac mini |
| launchd stdout/err | `~/.agentic-engine/launchd.{out,err}.log` | Mac mini |

## Cross-cutting learnings (worth remembering)

These came up this session and are not load-bearing in any single doc — capturing here so they don't get lost.

1. **macOS TCC blocks `launchd` from running scripts under `~/Documents/`.** Symptom: `bash: <script>: Operation not permitted` in `launchd.err.log`, plus `Bootstrap failed: 5: Input/output error`. Fix: install wrapper at `~/.<service>/` or `~/Library/Application Support/<service>/`. Already captured in `mac-mini-scheduler` skill v1.1.
2. **Tailscale Funnel allows exactly 3 public ports: 443, 8443, 10000.** Path-based routing can multiplex unlimited services per port. We took 10000 because 443 and 8443 were already in use for other services on the mini.
3. **`cat` is aliased to `rtk read` in the user's `~/.zshrc`** — heredoc redirects to `cat` silently produce 0-byte files. Use `command cat` to bypass. Captured in `mac-mini-scheduler` v1.1.
4. **Convex `op item create` from a service account fails with `(101) You do not have permission`** because the everyday service account is read-only. Prefix with `env -u OP_SERVICE_ACCOUNT_TOKEN` to fall back to user auth (Touch ID via 1Password desktop app). Captured in `1password` skill already.
5. **Convex Auth's default redirect callback only accepts URLs matching `SITE_URL`** — fine for a single-frontend deployment, but blocks multi-origin setups. The fix is `callbacks.redirect` with an explicit allowlist in `convex/auth.ts` + `redirectTo: window.location.origin` on the client. We have this wired today. Pattern is also documented inline in `convex/auth.ts`.
6. **React 18 StrictMode double-mounts effects in dev**, which broke our first attempt at per-mount idempotency keys for auto-trigger. Stable keys per `entity_ref` (no mount component) solve it. Pattern documented in `engine/src/routes/run.ts` comment.
7. **Heroku app SHAs require the suffix** (e.g. `convex-db-master-d31d50f579b2.herokuapp.com`) — the bare `convex-db-master.herokuapp.com` 404s. Bit us when `SITE_URL` was misconfigured pre-fix.

## Open items not in the roadmap

The roadmap captures the deliberately-sequenced next 5 iterations. These are smaller observations from the session that don't warrant their own roadmap entry but should be looked at when convenient:

- **One thread accumulated an error row alongside a successful move** (`todoist:task:6fx4PrPcmPGr8x2M`, the dress shirt). Move worked; error log might indicate transient SDK noise or a real edge case. Worth a forensic NDJSON read before assuming nothing's wrong.
- **Heroku builds keep breaking on UX-agent commits.** Two failures this session, both `noUnusedLocals` TS errors that didn't get caught locally before push (`mountId` orphan, `openAgent` orphan). A `.husky/pre-push` hook running `bun --cwd app tsc -b` would catch these. Worth ~15 min when someone has the energy.
- **The UX/auth agent is on a different branch** (`feat/convex-auth`) but landing commits on `main` regularly. Single-owner pattern from this session worked but expect occasional merge contention on `convex/`, `app/src/components/agent/*`, and `engine/src/`.

## Where to pick up next session

Per the roadmap, **item 1: Markdown rendering + "Ask X" → clarification fix**. Small surgery, fast payoff. Workflow:

1. Read the roadmap entry for item 1 (~10 lines).
2. Brainstorm → spec → plan → build via the superpowers flow.
3. The spec goes in `docs/superpowers/specs/2026-05-XX-markdown-and-clarification-fix-design.md`.
4. After it ships, run `bunx convex run 'agentic/queries/_adminDigest:default'` to confirm the "Ask X" mis-kinded proposals drop to zero on new conversations.

## Diagnostic helpers (already in place)

For when something goes wrong:

```bash
# List every conversation
bunx convex run 'agentic/queries/_adminListAll:default'

# Compact digest across all conversations (counts, last proposal, options)
bunx convex run 'agentic/queries/_adminDigest:default'

# Full thread for one entity (bypasses auth gate)
bunx convex run 'agentic/queries/_adminGetThread:default' \
  '{"entity_ref":"todoist:task:..."}'

# Delete phantom run rows (e.g. after a duplicate-fire bug)
bunx convex run 'agentic/mutations/_adminDeleteByRunId:default' \
  '{"run_id":"01K..."}'
```

These are internal queries/mutations under `convex/agentic/{queries,mutations}/_admin*` — the leading underscore keeps them out of the public `api` codegen, so they don't appear in the UX agent's typed API surface.

## Final thought

The substance of the agent's reasoning is strong — strong enough that the bottleneck is no longer the agent itself but the surface around it (how it asks questions, where receipts go, when chains continue, how state persists across sessions). The roadmap is built around closing that surface gap. Resist the urge to "make the agent smarter" before closing those gaps; the value compound comes from removing friction first, then investing in the brain.
