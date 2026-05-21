# Codex as an Alternate Coding Agent — Design Spec

**Status:** Draft for review (not yet a plan)
**Date:** 2026-05-21
**Builds on:** the agentic engine web server (`2026-05-15-agentic-engine-web-server-design.md`, shipped on `main`).
**Scope:** `engine/` only. No frontend or Convex schema changes required for v1.

## Purpose

Let the agentic engine run its discover-and-propose loads on **OpenAI Codex** as an alternative to Claude, selectable **per run**. Both agents stay available simultaneously; a `/run` request names which one handles that entity. Codex must reach the **same data-grounding tools** (airtable, obsidian-search, etc.) the Claude runner relies on, so its proposals are equally grounded.

**Conceptual reference:** [`pingdotgg/t3code`](https://github.com/pingdotgg/t3code) — a multi-provider GUI that abstracts over locally-authenticated coding-agent CLIs (`codex login`, `claude auth login`, `opencode auth login`), delegating auth to each CLI rather than managing keys. We mirror the *idea* (a provider abstraction over subscription-authenticated agents, open-ended for more providers), not its architecture: t3code speaks Codex's app-server JSON-RPC protocol on an Effect stack, whereas our engine already has a clean `AgentRunner` seam and uses provider **SDKs**. We stay consistent with that.

**North star:** Codex is a second implementation of the existing `AgentRunner` interface plus a thin selection layer. The proposal protocol, the queue, the store, the webhook delivery, and the routes are all agent-agnostic and unchanged.

## Current state (the seam we build on)

- `engine/src/runner/types.ts` defines `AgentRunner { run(input): Promise<AgentRunResult>; interrupt(entity_ref): Promise<void> }`, the `CanonicalEvent` union, and the opaque `resume_cursor: unknown` contract.
- `engine/src/runner/claudeSdkRunner.ts` implements it over `@anthropic-ai/claude-agent-sdk`'s `query()`. It owns three things that are actually agent-agnostic and will be lifted out: `DEFAULT_SYSTEM` (the proposal protocol prompt), `ProposalSchema` parsing, and `tryParseProposal`.
- `engine/src/server.ts` `buildServer(opts)` takes a single `runner: AgentRunner` and threads it into the run route, the per-entity queue's `onInterrupt`, and the interrupt route. At boot, `createClaudeSdkRunner()` is hardcoded.
- The Claude runner authenticates via the Claude Code **subscription** (`settingSources: ['user']` loads `~/.claude/`, including the symlinked skill library) and runs unattended via `permissionMode: 'bypassPermissions'`.

Codex is already installed and authenticated on the host: `~/.codex/auth.json` holds ChatGPT subscription tokens (`codex-cli 0.132.0`). The Codex SDK reuses that saved login, so Codex runs bill the **ChatGPT subscription**, mirroring how the Claude runner uses the Claude subscription. No API key is introduced.

## Architecture

### 1. Runner registry (selection layer)

`AgentRunner` is already the provider interface. We make the engine hold a keyed set of them instead of one.

- Introduce `type AgentId = "claude" | "codex"` (string-typed and extensible — OpenCode is a plausible third later).
- `BuildServerOpts.runner: AgentRunner` becomes:
  - `runners: Record<AgentId, AgentRunner>`
  - `defaultAgent: AgentId` (= `"claude"`)
- A small resolver picks the runner for a run: explicit `agent` on the request → else the run's previously-recorded agent (for follow-ups) → else `defaultAgent`.

### 2. Per-run agent selection + stickiness

- `POST /run` request body gains an optional `agent?: AgentId`, zod-validated against the registry keys. Absent ⇒ `defaultAgent`.
- The chosen agent is **recorded on the run** so follow-up turns and `EXECUTE:` approvals route back to the *same* agent. A proposal made by Codex must be executed by Codex; resuming a Codex thread on the Claude runner (or vice versa) is incoherent.
- **Mechanism — agent-tagged resume cursor.** The cursor is already opaque `unknown`. We wrap every runner's cursor in an envelope owned by the selection layer:

  ```ts
  interface TaggedCursor { agent: AgentId; cursor: unknown }
  ```

  - On `/run` with no `agent` field but an existing tagged cursor, the resolver reads `cursor.agent` and routes there. An explicit `agent` that conflicts with the stored cursor is rejected (400) rather than silently starting a fresh session on the other agent.
  - The selection layer unwraps `cursor.cursor` before calling the runner and re-wraps the returned cursor. Individual runners never see the tag — their cursor contract is unchanged.
- The interrupt route already routes by `entity_ref`; it must call `interrupt` on the *recorded* agent's runner. The per-entity queue's `onInterrupt` resolves the runner the same way `run` does.

> Storage note: the engine persists run state in Convex via `engine/src/store/convex.ts`. The recorded agent rides along inside the tagged cursor (already persisted), so **no Convex schema change is required for v1**. If we later want to query/sort runs by agent in the UI, denormalize an `agent` column then — out of scope here.

### 3. Shared proposal-protocol module

Extract from `claudeSdkRunner.ts` into a new `engine/src/runner/proposalProtocol.ts`:

- `DEFAULT_SYSTEM` (the full proposal-protocol + grounding + drafting-conventions prompt),
- `ProposalSchema` re-export and `tryParseProposal(text): Proposal | null`,
- a shared `proposalToTerminalEvent(proposal, checkpoint_id): CanonicalTerminalEvent` helper (the kind→event mapping currently inline in `normalize`).

`proposalSchema.ts` stays where it is; the protocol module composes it. Both runners import from here, guaranteeing Claude and Codex emit and parse the identical `<proposal>…</proposal>` contract. This is the one targeted refactor that makes parity cheap; it is behavior-preserving for the Claude runner (covered by existing tests).

### 4. `codexSdkRunner.ts`

New file implementing `AgentRunner` over `@openai/codex-sdk`, structurally mirroring `claudeSdkRunner.ts`.

- **Construction.** `new Codex()` (reuses `~/.codex` auth). A factory `createCodexSdkRunner(opts)` parallel to `createClaudeSdkRunnerOpts` — `systemPrompt`, `model`, `workingDirectory`, `additionalDirectories`-equivalent, defaulting to the same vault + GitHub roots.
- **Per-entity session.** Keep a `Map<entity_ref, { threadId: string | null; turn_count; ...}>`, mirroring the Claude runner's `SessionContext`. First turn: `codex.startThread({ workingDirectory, sandboxMode: 'danger-full-access', skipGitRepoCheck: true })`. Resume: `codex.resumeThread(threadId)`. (`danger-full-access` + skip-git mirror the Claude runner's `bypassPermissions`; the host's `codex` alias already runs in this mode, so this matches established local posture for an unattended trusted agent.)
- **Run + streaming.** Call `thread.runStreamed(prompt)` and iterate `result.events`. The prompt is the same JSON envelope `buildUserPrompt` produces today (`{ entity_ref, entity_payload, user_message }`), so the user-facing contract is identical.
- **Event normalization.** Translate Codex stream items → `CanonicalEvent`:

  | Codex stream item | CanonicalEvent |
  |---|---|
  | assistant message text | `assistant_message` (+ `token_usage` when present) |
  | reasoning / thinking item | `reasoning` |
  | command/tool execution begin | `tool_call_started` (`activity_key` = Codex item id) |
  | command/tool execution end | `tool_call_resolved` (`status` ok/error, `output`) |
  | final assistant turn | parse `<proposal>` → `proposal` / `execution_result` / `blocked` via the shared protocol module |
  | error / aborted turn | `error` |

  The exact Codex item type names are pinned during planning against `@openai/codex-sdk` at the version we install (verify `runStreamed` event shapes — `item.completed`, `item.started`, `turn.completed`, etc. — empirically; do not assume from this table).
- **Fallback parse.** Same as Claude: accumulate assistant text and, if no terminal event surfaced, `tryParseProposal` the transcript; else emit a structured `error`.
- **Cursor.** Inner cursor `{ thread_id, turn_count }`; the selection layer wraps it as `{ agent: "codex", cursor: {...} }`.
- **Interrupt.** Abort the in-flight `runStreamed` (AbortController if the SDK accepts a signal; otherwise the SDK's documented cancel/turn-abort) and drop the session entry, mirroring the Claude runner.

### 5. Full tool parity for Codex

Codex must reach the same skills the Claude runner uses to ground proposals.

- **Skill library.** Milad's skills are vault-canonical at `ClaudeConfig/skills`, symlinked into `~/.claude/skills` (what the Claude runner loads via `settingSources: ['user']`). Codex discovers skills from `~/.codex/skills` (currently only `.system/`). **Parity action:** symlink the same vault skill library into `~/.codex/skills` so Codex sees the identical agent-agnostic, CLI/script-based skills (`gog`, `op read`, REST-based airtable/obsidian, etc.). superpowers already ships `using-superpowers/references/codex-tools.md` mapping Claude tool names → Codex equivalents, so cross-agent skills resolve.
- **System prompt.** Pass the shared `DEFAULT_SYSTEM` as the Codex thread's base instructions (the proposal protocol, grounding rules — "≥2 substantive tool calls" — and Milad's drafting conventions: no Gmail drafts, no em dashes in copy authored for him).
- **MCP shims.** Only needed for skills that are *not* CLI/script invocable from Codex. Expected to be few or none for v1. **Planning step:** audit the skills the Claude runner actually exercises in discovery (airtable, obsidian-search, the read-heavy data skills) and confirm each runs under Codex as-is; flag any that need an MCP server, and treat those as a small follow-up rather than a v1 blocker.

This skills-via-symlink approach is the deliberate parallel to the Claude runner's `settingSources: ['user']`: same source of truth, same library, different agent loader.

## Data flow (per run)

```
POST /run { entity_ref, agent?, message? }
  → resolver: agent = explicit ?? cursor.agent ?? defaultAgent   (conflict ⇒ 400)
  → queue.enqueue(entity_ref, …)  [per-entity serialization unchanged]
      → runners[agent].run({ …, resume_cursor: unwrap(taggedCursor) })
          → on_event(CanonicalEvent)  → ndjson log + webhook + store  [unchanged, agent-agnostic]
          → returns { resume_cursor, terminal }
      → store tagged cursor { agent, cursor }
  → 202 (async) / terminal (wait variant)
```

Reads (`GET /run/:entity_ref[/status]`), interrupt, and health are unchanged except that interrupt resolves the runner by recorded agent.

## Error handling

- **Unknown `agent` value:** 400 at the route (zod enum over registry keys).
- **Agent/cursor conflict:** 400 ("entity already has an in-progress session on `<agent>`; omit `agent` to continue or interrupt first").
- **Codex not authenticated / SDK init failure:** the runner surfaces a `CanonicalEvent` `error` with a clear message ("codex login required" / SDK error), handled by the same `lastError` path in `buildServer`. The engine does not crash; other entities and the Claude runner are unaffected.
- **Codex turn abort/timeout:** mapped to a terminal `error` event, same as Claude's result-error subtypes.

## Testing

- `engine/src/runner/codexSdkRunner.test.ts` mirroring `claudeSdkRunner.test.ts`: feed a faked SDK stream and assert the `CanonicalEvent` sequence, cursor round-trip (`thread_id`/`turn_count`), and proposal/execution_result/blocked/error parsing.
- `engine/src/runner/proposalProtocol.test.ts`: move/keep the `tryParseProposal` + schema tests here; assert Claude-runner behavior is unchanged (no regression from the extraction).
- Selection-layer tests: explicit-agent routing, cursor-tag stickiness on follow-ups, agent/cursor conflict ⇒ 400, interrupt routes to the recorded runner. Place alongside the run/interrupt route tests.
- `echoRunner` stays the default test double; the registry makes injecting per-test runners trivial.
- Validation gate (repo standard): `bun run typecheck && bun run lint && bun test` clean before merge.

## Rollout

- Ship behind the per-run `agent` param **defaulting to `claude`**. Nothing changes for existing callers until a request opts in with `agent: "codex"`.
- Boot wiring: `createSourceRegistry` pattern already exists; add `runners: { claude: createClaudeSdkRunner(), codex: createCodexSdkRunner() }` and `defaultAgent: "claude"` in `server.ts`'s `import.meta.main` block.
- Manual parity check before declaring done: run the same Todoist entity through both agents (`agent: "claude"` then `agent: "codex"` on a fresh entity_ref) and compare proposals for grounding quality and schema validity.
- `engine/README.md` updated: new `agent` field, the `~/.codex/skills` symlink prerequisite, and `codex login` as a host prerequisite alongside the Claude subscription.

## Out of scope (v1)

- Frontend agent picker / per-run agent badge in the UI (backend accepts the param; UI surfacing is a later, small follow-up — and intersects the in-flight `agent-mode-convergence` work).
- Convex schema column for `agent` (cursor-tag carries it; denormalize only if/when the UI needs to filter/sort by agent).
- A third provider (OpenCode). The registry is intentionally open-ended, but only claude + codex are built here.
- A/B / dual-run comparison harness and automatic failover. Per-run choice is the v1 surface; orchestration policies layer on top of the registry later.
- MCP servers for any non-CLI skill — audited in planning, deferred unless a required discovery skill genuinely needs one.

## Open questions for planning

1. Exact `@openai/codex-sdk` stream event taxonomy at the pinned version (verify empirically; the normalization table above is provisional).
2. Whether `runStreamed` exposes per-turn token usage for `token_usage` parity; if not, that field is simply omitted for Codex.
3. Interrupt mechanism the SDK actually supports (AbortSignal vs an explicit cancel/turn-abort call).
4. The precise set of discovery skills to smoke-test for Codex parity, and whether any need an MCP shim.
