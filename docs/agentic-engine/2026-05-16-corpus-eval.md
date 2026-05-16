# Agentic Engine — Corpus Eval (2026-05-16)

First substantive evaluation pass across all conversations the engine has produced so far. **35 conversations**, all on Todoist tasks, accumulated during the build-out session that landed the engine on `main` + Heroku.

This is a snapshot. Future iteration agents should read it before making product changes — the patterns here are the rationale for what we work on next.

## How this was generated

Internal admin queries `_adminListAll` + `_adminDigest` swept every `agenticRuns` row plus its messages and activities. Both queries live under `convex/agentic/queries/_admin*` (leading underscore keeps them out of public API codegen). Re-run them anytime to get a fresh snapshot.

```bash
bunx convex run 'agentic/queries/_adminDigest:default'
```

## Corpus shape

| Metric | Value |
|---|---|
| Total conversations | 35 |
| Entity type | All `todoist:task:*` (no other entity sources wired yet) |
| Conversations that reached EXECUTE | 8 (~23%) |
| Conversations with at least one error message | 2 |
| Tool calls per conversation | avg 15.8, min 0, max 81 |
| Conversations with zero tool calls | 1 (the CRM-Airtable case, predates tool wiring) |
| Latest-proposal kind distribution | 33 `proposal`, 2 `clarification` |
| Option count per proposal | 28× 4-option, 5× 3-option, 2× 5-option |
| `recommended_option_id` set | 35 / 35 |
| Confidence range (across 137 options) | 0.10–0.95, avg 0.56 |
| Reversibility distribution | 99 trivial / 34 moderate / 4 destructive |

Read: the agent commits to a default on every proposal, uses the confidence scale honestly, biases toward trivial actions for triage work, and is willing to flag destructive consequences when warranted.

## Substance — agent reasoning quality

**Strong overall.** The brand investment is paying off: cross-entity reasoning, willingness to refuse-when-uncertain, and grounded recommendations all visible in the corpus.

Reference exemplars:

- `todoist:task:6cWfQ846cHxr77jv` — "Automated artist email system." Agent grepped `afternoonumbrellafriends.com`, found existing implementation with line numbers, recommended rewriting the Todoist task to reflect actual remaining gaps rather than proposing to "build" something already shipped. EXECUTE landed cleanly.
- `todoist:task:6g44QJg6GJ8PqJHv` — "watty investor" cascade. Agent moved the task, proactively surfaced parallel `matt spencer potential investor` in Inbox, offered broader sweep across 50 inbox tasks, refused to route 6 ambiguous lone-name entries. Exactly the right judgment shape.
- `todoist:task:6WfqcxHGGmRjwWmv` — "Make an airtable view to sync with my contacts to Google contacts" — first conversation, predates tool wiring. Agent confabulated from training; recommendations sounded plausible but were ungrounded. The fix (`settingSources: ['user']` + `additionalDirectories`) closed this class of failure.

Failure mode observed once (`6fx4PrPcmPGr8x2M`, dress shirt): one error row recorded alongside a successful move. Worth a closer look — could be transient SDK noise or could indicate a real edge case in the run pipeline.

## Surface — UX issues representative across the corpus

### 1. "Ask X" anti-pattern

**The biggest concrete UX bug.** Seven explicit instances in latest proposals where an option is functionally "the user asks the user":

| entity | option label |
|---|---|
| watty investor | "Ask: who is Watty?" |
| alex's mailbox | "Ask: who/where is Alex's mailbox?" |
| theme task | "Ask Milad what 'theme' meant" |
| Brooklyn Bowl | "Confirm Brooklyn Bowl fallback" |
| enrich task | "Ask + enrich task" |

Plus two legitimately external-ask actions ("Ask Jacob via Slack/email", "Ask Sarah to clarify her preference") — those are real proposal actions and should stay.

**Root cause:** the agent is using `kind: "proposal"` when it should be using `kind: "clarification"` with a populated `question` field and free-text input. The system prompt allows but doesn't force the right kind for context-from-user gaps.

**Fix shape:** tighten the system prompt — "If you need context only the user has, use `kind: 'clarification'` with `question` set. Do NOT add a `proposal` option labeled 'Ask X' when X is the user." The UX side already has the clarification rendering shape (we wrote it into the spec early on); just need the kind to be chosen correctly.

### 2. Receipt vs follow-up conflated

`execution_result` rows stuff both the action receipt ("✓ Moved task to Funding") AND the next conversational thought ("Heads up: parallel inbox entry..." or "next pass through Inbox I can sweep") into one `body_markdown`. Visually they're one green card; conceptually they're two distinct moves. Splitting receipt-from-followup is the architectural fix (auto-chain a discovery turn after EXECUTE).

### 3. Status / composer / decide UI mismatch

After `execution_result` lands, status flips to `awaiting_decision` and the composer prompts "Ask a question or describe a modification…" — but there's nothing to decide. Should be: status `idle` (or new `done`), receipt rendered without decide UI, composer either hidden or much more passive ("Anything else?").

### 4. Markdown not parsed in message bubbles

Backticks render literally. Task IDs like `` `6g44QJg6GJ8PqJHv` `` show with visible backticks instead of monospace inline code. Probably need to wire `react-markdown` + `remark-gfm` into the message bubble components.

## System — triggers, persistence, chains

### Already working

- Drawer-open auto-trigger with stable per-entity idempotency key (post the StrictMode race fix).
- Per-entity work queue serializing turns correctly.
- EXECUTE write path: 8 successful executions in the corpus.
- Session resumption via `resume_cursor` carrying `session_id` across turns.

### Missing primitives

- **Skip / defer / scheduled-reopen.** 35 conversations, only 8 executed. 24 are sitting in `awaiting_decision` with no obvious next move from the user. Without skip/defer, they linger as a perpetual queue. Need:
  - **Skip:** mark idle, no run, available on every proposal.
  - **Defer:** scheduled reopen via `ctx.scheduler.runAt` at a `defer_until` timestamp. Agent-set or user-set.
- **Auto-chain after EXECUTE.** Today's EXECUTE is terminal even when the task isn't truly done (move to project = organizational, not completion). Engine should fire one more discovery turn implicitly to decide whether to chain.
- **Multi-trigger taxonomy.** Today only "drawer open" triggers a run. Could also trigger on: deadline approaching, priority bumped, label added/removed, new comment, scheduled sweep, defer timer fires.
- **Entity-update-aware re-discovery.** The no-op guard (existingRun → skip) prevents drawer-reopen from re-running, which is right. But if the entity itself changed since the last run (description edited, comment added), there's no automatic way to redo discovery against the new state.

### Per-Todoist-field surface barely used

Todoist tasks have `priority`, `due`, `deadline`, `labels`, `description`, `project_id`, `content`. The agent reads all of these in summaries. But EXECUTE writes only touch `project_id` and `content`. Plenty of headroom: change priority, set/clear due dates, add/remove labels, edit descriptions in place. Many proposals describe these moves in `description` but don't translate them into actions yet — partly because no skill exists for those write paths.

## Brain — your most important observation

**The substance quality is downstream of the brain's investment, not the engine's.**

Evidence: the artist-advancing conversation worked because the vault knew about AUF Bookings, Music Artists, Events, Advance Thread Started fields. The watty cascade worked because the AUF > Funding project exists and is recognizable to the agent.

Three concrete gaps in the brain that showed up:

1. **People entities are thin.** Conversations reference people by first name (Watty, Alex, Jacob, Sarah, Lana, Antonio, Jake, Jimmy, Nikhil, Arvind) without the agent having any source to resolve them. Half the "Ask: who is X?" awkwardness disappears once the agent can grep a `People/` directory or AUF Humans table for these names.
2. **Chat logs not yet a context source.** This corpus of 35 conversations contains substantive decisions, audits, and rationales — none of which are anywhere a future agent run can read. Distilling these into Workspaces/References/entity-specific durable notes is a high-leverage move.
3. **Most vault workspaces underutilized.** Conversations didn't reference Workspaces/Events, Workspaces/Assistant, etc. even when they would have been relevant. Either those areas are thinner than Finance's, or the agent doesn't know to look there yet.

## Recurring patterns worth naming

- **"Ambiguous lone-name entries"** — recurring shape in inbox triage: agent correctly refuses to route entries like "ky william" or "tell nikhil" when context is missing. Same shape powers the "Ask who is Watty" pattern. Maps directly to the People-entities gap.
- **"Already-done by other means"** — the artist-advancing audit. Probably more of these in inbox if we ran sweeps. A scheduled `inbox-stale-audit` agent loop becomes possible once defer/auto-trigger primitives land.

## Candidate next-iteration buckets

To be picked through in the brainstorming pass that follows this doc:

- **Tier 0 (UX/representation fixes):**
  - Markdown parsing in message bubbles
  - Status + composer cleanup post-EXECUTE
  - Mis-kinded "Ask X" proposals → clarifications
- **Tier 1 (small system primitives):**
  - Skip button on every proposal
  - Auto-chain discovery after EXECUTE
- **Tier 2 (entity-field surface expansion):**
  - Action surfaces for `priority`, `due`, `deadline`, `labels`
  - Todoist field-change triggers (priority bump, deadline approach)
- **Tier 3 (brain investment):**
  - People entities or AUF Humans enrichment
  - Conversation distillation into durable vault notes
- **Tier 4 (scheduling primitives):**
  - Defer with scheduled reopen
  - Agent-set auto-bumps with `defer_until`
- **Tier 5 (cross-entity loops):**
  - Scheduled inbox sweeps for stale/already-done patterns
  - Cross-entity reasoning (compare related tasks, surface duplicates)

The brainstorming pass below will pick which 2–3 to advance and write specs.
