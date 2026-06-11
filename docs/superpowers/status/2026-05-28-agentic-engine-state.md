# Agentic Engine — State of the Project

**Snapshot date:** 2026-05-28 · **Status:** disposable point-in-time snapshot (not a durable spec — supersede freely)
**Canonical tracker:** Todoist "Agentic Engine" (`6ggw7xrhh439R5wg`) · **Entity:** `~/Documents/milad-vault/Services/Agentic Engine.md`

---

## The vision

An HTTP server wrapping the Claude Agent SDK into an **async, durable, multi-entity agentic decision engine.** Every actionable thing — a Todoist task today, an email thread or message thread tomorrow, a contact/booking after that — is an `entity` (`system:kind:id`). The engine runs structured *discover-and-propose* turns against each entity, grounded in Milad's real data via his full skill arsenal and filesystem reach. Sessions persist forever in Convex.

**North star (set 2026-05-28):** go from a *pull-only, single-entity-type* triage tool to a **multi-entity, proactive assistant** that wakes up, scans Milad's world overnight on spare token budget, and hands him a ranked stack of live decisions in the morning — without torching his credits.

The flagship that embodies this: a **budget-aware autonomous job runner** (see Tier 1). Everything else either feeds it (composite score, staleness, tiered routing, Codex as a 2nd token pool), unblocks it (daemonize + auth), or widens what it operates on (email/message/contact entities).

---

## Where we are

**Working today (smoke-validated end-to-end since 2026-05-15):**
- Core loop: `POST /run` → discovery turn → zod-validated proposal → `EXECUTE:` → real Todoist mutation.
- Per-entity queue serializes turns; Claude SDK runner; 4 proposal kinds (`clarification` / `proposal` / `execution_result` / `blocked`).
- `proposal.urgency` denormalized onto `agenticRuns.last_urgency` with a sort index.
- Agent-mode UI: `ProposalCard`, `ClarificationCard`, urgency tinting; keybinding hook defined.
- Only `todoist:task:*` is wired (`TodoistTaskSource`).

**The problem that shaped the roadmap:** a corpus eval of 35 conversations found **24/35 stuck in `awaiting_decision` with no next move.** The engine can discover and execute, but it can't *settle* — no skip, no defer, no "you executed, now what," no cross-entity comparable priority. It demos well; it isn't yet a daily tool.

**Foundational debt (gates everything autonomous):** engine runs from a shell (not daemonized — plist exists, uninstalled); no auth on the public endpoint; no Convex Auth; `interrupt()` can't cancel in-flight work; sessions orphan if `cwd` changes.

---

## Roadmap by tier

**Tier 0 — Foundation (nothing autonomous works without these)**
- Daemonize + auth (launchd on Mac mini, token, Cloudflare Tunnel, Convex Auth, interrupt fix)
- Staleness field (`last_discovered_at`) — selection signal for the job runner
- Composite priority score v1 — cross-type ranker (design locked, see below)

**Tier 1 — The autonomy spine**
- Tiered model routing (Haiku pre-filter → Opus discovery) — the cost gate
- Codex runner — second token pool (spec'd, 0/7 built)
- **Budget-aware job runner [FLAGSHIP]** — needs all of the above
- Proactive pull → push surfacing (top decisions to Slack/iMessage/brief, likely via the Assistant agent)

**Tier 1b — Breadth (parallel with the spine)**
- Email-thread entity (`gmail:thread:*`) · Message-thread entity (`imessage`/beeper) — proves the abstraction + captures what's currently slipping

**Tier 2 — Make it smart / keep it honest**
- Skip / auto-chain / defer (original loop fixes — keep the queue clean)
- Engine-local learning loop · standing corpus-eval harness · Todoist metadata writes · inbox-to-zero route · draft-card widget

**Tier 3 — Heavy / dependent**
- Cross-entity reasoning (topic clustering) · cross-agent session-log learning (likely its own project) · contact/CRM entity (blocked on CRM setup)

---

## Composite priority score — design v1 (locked)

Pure deterministic fn → **0–100, comparable across every entity type**:
```
score = 100 · Σ(wᵢ·sᵢ for PRESENT i) / Σ(wᵢ for present i) · actionability_factor
```
Signals + default weights: AI urgency 0.30 · Todoist priority 0.20 · due proximity 0.25 · deadline proximity 0.15 · project/event deadline 0.10.
`actionability_factor`: awaiting_decision+recommended → 1.0; clarification → 0.6; discovering/idle → 0.3; deferred/skipped/blocked → 0.

**Invariant — missing ≠ zero:** absent signals are *excluded and weights renormalized*, never scored as 0 (that would punish the unscored default state). Todoist priority specifically: the API can't distinguish explicit P4 from never-set, so P4/none = absent. Tuning knob for later: a coverage discount so confident-but-thin items don't beat well-evidenced ones.

**Staleness is deliberately NOT in this score** — it drives the job runner's *selection*, not the priority of acting. Separate axes.

---

## Current execution wave — 4 parallel lanes

Binding constraint: **one shared Convex dev deployment** — only Lane D may touch schema / push the deployment.

| Lane | Work | Where | Concurrency |
|---|---|---|---|
| **A — Infra** | Daemonize + auth + interrupt fix | worktree `lane-a` | parallel |
| **B — Runner** | Codex runner (7-task plan) | worktree `lane-b` | parallel |
| **C — Frontend** | Decision-key wiring + collapsed-group nav | worktree `lane-c` | parallel |
| **D — Schema** | skip → staleness → last_chatted_at → defer → denormalize | **main checkout** | serialized; owns deployment |

Handoff prompts: `/tmp/agentic-engine-handoffs/lane-{A,B,C,D}-*.md` (regenerate from this doc if needed).

**Held back this wave (collision avoidance):** auto-chain after EXECUTE (collides with B's `claudeSdkRunner` refactor → after B), Convex Auth (deployment race with D → after D), composite-priority-score (builds on D's fields → after D).

---

## Open decisions

1. Job-runner budget ceiling — per rolling window, or per calendar day?
2. First non-Todoist entity — leaning **messages** (where things actively get missed).
3. Composite score: precompute on `agenticRuns` vs derive at query time (current lean: derive — arithmetic is cheap, due-proximity changes daily).
4. CRM data store (Airtable AUF humans vs new Convex table) — blocks the contact entity; Milad owns standing it up.
