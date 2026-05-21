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

### The platform boundary (the core principle)

The overriding design constraint: **changes to how agentic responses are formatted must never require platform-specific work.** We achieve that by drawing one hard line.

- A **platform adapter** (Claude, Codex, …) knows only two things: how to drive its SDK's *session lifecycle* (start/resume/interrupt) and how to *translate its raw stream* into our neutral transcript vocabulary. It knows **nothing** about proposals, the `<proposal>` contract, the schema, terminal-event derivation, or the system prompt's protocol section.
- A **shared run harness** wraps every adapter and owns **everything** about response shape: it injects the protocol system prompt, consumes the adapter's neutral stream, accumulates the final assistant text, parses/validates the `<proposal>`, derives the terminal event, runs the fallback parse, and emits errors. It also owns the agent-tagged cursor envelope.

| Concern | Where it lives | Changing it touches |
|---|---|---|
| `<proposal>` contract, `DEFAULT_SYSTEM`, schema, parsing, terminal-event derivation, fallback parse | **Shared harness + `proposalProtocol.ts`** | one place, all platforms at once |
| `CanonicalEvent` / transcript vocabulary | **Shared (`runner/types.ts`)** | one place |
| Agent-tagged cursor, selection/stickiness | **Shared selection layer** | one place |
| SDK construction + subscription auth | Adapter | that adapter only |
| Session/thread resume semantics | Adapter | that adapter only |
| Raw stream item → neutral transcript event | Adapter | that adapter only |
| Interrupt/abort mechanism | Adapter | that adapter only |
| How skills/tools + instructions are surfaced to the platform | Adapter | that adapter only |

If a future change to the response format forces an edit inside `claudeAdapter.ts` or `codexAdapter.ts`, the boundary has been drawn in the wrong place and is a bug in the design.

### 1. Runner registry (selection layer)

`AgentRunner` (the existing `run` + `interrupt` interface the server consumes) stays the contract the server sees. Each entry in the registry is a thin **adapter** wrapped by the shared harness into an `AgentRunner` (see §3). We make the engine hold a keyed set instead of one.

- Introduce `type AgentId = "claude" | "codex"` (string-typed and extensible — OpenCode is a plausible third later).
- `BuildServerOpts.runner: AgentRunner` becomes:
  - `runners: Record<AgentId, AgentRunner>` — each built as `createRunner(adapter)`
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

### 3. The shared run harness + adapter contract (the platform-agnostic core)

This is where the boundary is enforced. Two pieces.

**(a) The adapter contract** — `engine/src/runner/types.ts`:

```ts
// Neutral transcript events an adapter emits — the non-terminal CanonicalEvents.
type TranscriptEvent = Exclude<CanonicalEvent, CanonicalTerminalEvent>;
// i.e. user_message | assistant_message | reasoning | tool_call_started | tool_call_resolved

// Internal turn-completion sentinel (not forwarded to consumers as-is).
interface TurnComplete {
  type: "turn_complete";
  final_text: string;            // the text the harness scans for <proposal>
  usage?: TokenUsage;
  native_error?: { message: string; details?: unknown };  // SDK turn error (max turns, abort…)
  session_id: string | null;     // platform-native resume handle for the next turn
}

type AdapterEvent = TranscriptEvent | TurnComplete;

interface AdapterTurnInput {
  entity_ref: string;
  prompt: string;                // the JSON envelope built by the shared harness
  system_prompt: string;         // DEFAULT_SYSTEM, injected by the harness
  session_id: string | null;     // from the previous turn's TurnComplete, or null
}

interface AgentAdapter {
  id: AgentId;
  // Drive one turn: yield transcript events as they stream, end with exactly one TurnComplete.
  run(input: AdapterTurnInput): AsyncIterable<AdapterEvent>;
  interrupt(entity_ref: string): Promise<void>;
}
```

The adapter never imports `ProposalSchema`, never sees `Proposal`, never constructs a terminal event. It translates its SDK stream into `TranscriptEvent`s and reports turn completion with the raw final text + native resume handle. That is the entire platform-specific surface.

**(b) The harness** — `engine/src/runner/createRunner.ts` + `engine/src/runner/proposalProtocol.ts`:

- `proposalProtocol.ts` holds the response-format logic, extracted from `claudeSdkRunner.ts`: `DEFAULT_SYSTEM`, `tryParseProposal(text): Proposal | null`, and `proposalToTerminalEvent(proposal, checkpoint_id): CanonicalTerminalEvent` (the kind→event mapping currently inline in `normalize`). `proposalSchema.ts` stays put; this module composes it.
- `createRunner(adapter: AgentAdapter): AgentRunner` is the wrapper every registry entry uses. Per turn it:
  1. Builds the prompt envelope (`buildUserPrompt`) and passes `DEFAULT_SYSTEM` as `system_prompt`.
  2. Iterates the adapter's `AdapterEvent`s. Each `TranscriptEvent` is forwarded verbatim to `on_event`; assistant text is accumulated.
  3. On `TurnComplete`: parse `final_text` for `<proposal>` (or fall back to the accumulated transcript), validate via the schema, derive the terminal `CanonicalEvent` via `proposalToTerminalEvent`, and emit it. If `native_error` is set and no proposal parses, emit a terminal `error`.
  4. Returns `{ resume_cursor, terminal }`, with `resume_cursor` carrying the adapter's `session_id` (then wrapped by the selection layer's agent tag — §2).

**Why this matters for Milad's constraint:** every decision about response shape — the protocol prompt, what counts as a valid proposal, how a parsed proposal becomes a terminal event, the fallback behavior — lives in (b) and runs identically for all platforms. Adding OpenCode, or changing the proposal schema, never touches an adapter. The existing Claude logic is *moved*, not rewritten, so the change is behavior-preserving and guarded by the current `claudeSdkRunner` tests (which become `claudeAdapter` + harness tests).

### 4. The two adapters

Both are thin: SDK lifecycle + stream translation only. Neither imports the protocol module.

**`claudeAdapter.ts` (refactor of today's `claudeSdkRunner.ts`).** The existing file's `normalize()` already produces the transcript events; the change is to *stop* it parsing proposals or building terminal events inline. Instead it yields `TranscriptEvent`s and, when the SDK's `result` message arrives, yields a single `TurnComplete { final_text: result.result, usage, native_error, session_id }`. `DEFAULT_SYSTEM`, `tryParseProposal`, and the kind→event mapping move to `proposalProtocol.ts`. Construction (`settingSources: ['user']`, `bypassPermissions`, cwd/additionalDirectories) is unchanged. Behavior-preserving, guarded by the migrated tests.

**`codexAdapter.ts` (new).** Implements `AgentAdapter` over `@openai/codex-sdk`.

- **Construction.** `new Codex()` (reuses `~/.codex` auth). Factory `createCodexAdapter(opts)` — `model`, `workingDirectory`, additional reachable dirs — defaulting to the same vault + GitHub roots as the Claude adapter.
- **Per-entity session.** `Map<entity_ref, { threadId: string | null }>`. First turn: `codex.startThread({ workingDirectory, sandboxMode: 'danger-full-access', skipGitRepoCheck: true })`; resume: `codex.resumeThread(session_id)`. (`danger-full-access` + skip-git mirror the Claude adapter's `bypassPermissions`; the host's `codex` alias already runs this way — established posture for an unattended trusted agent.)
- **Run + streaming.** `thread.runStreamed(input.prompt)`; iterate `result.events`, translating each into a `TranscriptEvent`:

  | Codex stream item | TranscriptEvent |
  |---|---|
  | assistant message text | `assistant_message` (+ `token_usage` when the SDK exposes it) |
  | reasoning / thinking item | `reasoning` |
  | command/tool execution begin | `tool_call_started` (`activity_key` = Codex item id) |
  | command/tool execution end | `tool_call_resolved` (`status` ok/error, `output`) |

  When the stream ends, yield one `TurnComplete { final_text, usage, native_error, session_id: threadId }`. `final_text` is the last assistant turn's text (the harness scans it for `<proposal>`; the adapter does not). The exact Codex item type names are pinned during planning against the installed `@openai/codex-sdk` (`item.completed`, `item.started`, `turn.completed`, etc. — verified empirically, not assumed from this table).
- **Interrupt.** Abort the in-flight `runStreamed` (AbortSignal if the SDK accepts one; otherwise the SDK's documented cancel/turn-abort) and drop the session entry.
- **No proposal logic.** The adapter never parses `<proposal>` or emits terminal events — the harness does, identically to Claude.

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

The adapter/harness split makes each layer testable in isolation:

- `engine/src/runner/proposalProtocol.test.ts`: the moved `tryParseProposal` + schema + `proposalToTerminalEvent` tests. This is where all response-format behavior is asserted, once, platform-independently.
- `engine/src/runner/createRunner.test.ts`: drive the harness with a **fake adapter** that emits a scripted `AdapterEvent` sequence; assert transcript passthrough, proposal/execution_result/blocked/error derivation, fallback parse, and cursor round-trip. No SDK involved — this proves the format logic works for *any* adapter.
- `engine/src/runner/codexAdapter.test.ts`: feed a faked `@openai/codex-sdk` stream; assert it yields the right `TranscriptEvent`s + a well-formed `TurnComplete`. Asserts translation only — never proposals.
- `engine/src/runner/claudeAdapter.test.ts`: the migrated `claudeSdkRunner` tests, narrowed to translation + `TurnComplete` (proposal assertions move to the harness/protocol tests). Confirms the refactor is behavior-preserving.
- Selection-layer tests: explicit-agent routing, cursor-tag stickiness on follow-ups, agent/cursor conflict ⇒ 400, interrupt routes to the recorded runner. Place alongside the run/interrupt route tests.
- `echoRunner` stays the default test double; the registry makes injecting per-test runners trivial.
- Validation gate (repo standard): `bun run typecheck && bun run lint && bun test` clean before merge.

## Rollout

- Ship behind the per-run `agent` param **defaulting to `claude`**. Nothing changes for existing callers until a request opts in with `agent: "codex"`.
- Boot wiring: `createSourceRegistry` pattern already exists; add `runners: { claude: createRunner(createClaudeAdapter()), codex: createRunner(createCodexAdapter()) }` and `defaultAgent: "claude"` in `server.ts`'s `import.meta.main` block.
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
