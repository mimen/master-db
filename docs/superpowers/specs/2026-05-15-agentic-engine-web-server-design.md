# Agentic Engine — Web Server Design

**Date:** 2026-05-15
**Status:** Draft, ready for implementation planning
**Scope:** Server-side only. The Todoist web app and any other clients are out of scope of this document, though their needs shape the API.

## Purpose

Build the HTTP server that wraps Claude Code into an async, durable, multi-entity agentic decision-making engine. The server receives `{entity_ref, message?}` requests, runs an LLM agent with full skill / MCP context against the entity, persists the resulting thread to Convex, and returns control to a client (or to itself if auto-executing) for the next decision.

The server is the first concrete piece of a broader system that will eventually orchestrate agentic runs over Todoist tasks, emails, text messages, and other "entity" surfaces. Per-entity reactivity is delivered via Convex, not by the server itself.

## High-level architecture

Single repo. The agentic engine is a third sibling package inside `master-db/`, alongside the existing `app/` and `convex/` directories. This gives the server typed access to Convex generated APIs (`import { api } from "../convex/_generated/api"`), keeps schema migrations and the code that consumes them in the same commit, and runs through one `bun install` / one typecheck / one lint.

```
~/Documents/GitHub/master-db/
├── convex/
│   ├── schema.ts                       ← imports per-service schema modules
│   ├── schema/
│   │   ├── todoist/                    (existing)
│   │   └── agentic/                    ← new
│   │       ├── agenticRuns.ts
│   │       ├── agenticThreadMessages.ts
│   │       ├── agenticThreadActivities.ts
│   │       └── index.ts                (barrel)
│   ├── todoist/                        (existing)
│   └── agentic/                        ← new, follows todoist/ convention
│       ├── queries/
│       │   ├── getRun.ts
│       │   ├── getThread.ts
│       │   └── getActivities.ts
│       ├── mutations/
│       │   ├── upsertRun.ts
│       │   ├── appendThreadMessage.ts
│       │   ├── recordActivity.ts
│       │   └── updateRunStatus.ts
│       ├── types/
│       │   └── runStatus.ts
│       ├── queries.ts                  (barrel)
│       └── mutations.ts                (barrel)
├── app/                                (existing — Vite + React UI)
├── engine/                             ← new sibling package, the HTTP server
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── server.ts                   ← Hono app entry point
│   │   ├── routes/
│   │   │   ├── run.ts                  ← POST /run + POST /run/:entity_ref/wait
│   │   │   ├── readRun.ts              ← GET /run/:entity_ref + /status
│   │   │   ├── interrupt.ts            ← POST /run/:entity_ref/interrupt
│   │   │   └── health.ts               ← GET /healthz
│   │   ├── runner/
│   │   │   ├── types.ts                ← AgentRunner interface, canonical event taxonomy
│   │   │   ├── proposalSchema.ts       ← zod schema for Proposal
│   │   │   ├── echoRunner.ts           ← test-only fake runner
│   │   │   └── claudeSdkRunner.ts      ← Claude Agent SDK adapter
│   │   ├── sources/
│   │   │   ├── types.ts                ← EntitySource interface
│   │   │   ├── todoistTask.ts          ← reads Todoist task via Convex client
│   │   │   └── registry.ts             ← entity_ref dispatch
│   │   ├── store/
│   │   │   └── convex.ts               ← typed wrapper over ConvexHttpClient
│   │   ├── concurrency/
│   │   │   ├── perEntityQueue.ts
│   │   │   └── idempotencyCache.ts
│   │   ├── logging/
│   │   │   ├── ndjson.ts               ← per-entity shadow log on disk
│   │   │   └── logger.ts               ← structured stdout logger
│   │   ├── webhook/
│   │   │   └── deliver.ts              ← outbound webhook POST + retry
│   │   ├── auth.ts                     ← bearer middleware
│   │   └── env.ts                      ← zod-validated env vars
│   └── test/                           ← integration tests
└── skills/
    └── discover-and-propose/           ← the discovery skill (consumed by ClaudeSdkRunner)
```

Master-db's existing `bun --cwd app` convention extends naturally: `bun --cwd engine` runs the engine's own scripts (start, dev, typecheck). Tests run via the root `vitest run` and pick up `engine/**/*.test.ts` automatically. The root `bun run typecheck` script grows to include `bun --cwd engine tsc --noEmit`.

Runtime topology:

- Single long-running Bun process on the Mac mini.
- Behind a Cloudflare Tunnel; reachable at a public HTTPS URL.
- All `Bearer` requests validated against a shared secret from 1Password (`op://Sol/agentic-engine/server_token`).
- Holds one `ConvexHttpClient` writing to master-db's Convex deployment.
- Holds one Claude Agent SDK runtime; spawns one in-process session per active entity_ref, serialized by a per-entity queue.

### Architectural rule: the server is a thin proxy

The server's job is exactly three things: (1) translate `POST /run` into queued work, (2) drive the Claude Agent SDK and normalize its event stream into Convex projections, (3) accept structured user input and feed it back to the SDK. **Everything else lives elsewhere.** Specifically:

- Auto-execute rules live in the client or in a Convex action — not the server.
- Notifications (Beeper, Slack, push) live in Convex actions watching status transitions — not the server.
- Cross-entity reasoning, summarization, project-level synthesis — not the server; higher-level layers built on top of Convex projections.
- Source-of-truth entity data — fetched fresh from its native source on each turn; the server never caches business state.

If a new feature feels like server logic, the default is to push it out — into the skill, into a Convex action, or into the client. The server should stay boring and predictable forever. (Pattern lifted from OpenHands' explicit "thin proxy, no logic" rule.)

Data flow on a discovery call:

1. Convex action sees a Todoist task that needs a proposal → POSTs `/run` with `{entity_ref: "todoist:task:<id>", message: null}` and an `Idempotency-Key`.
2. Server validates bearer. Looks up the idempotency cache; on cache hit, returns the cached response without further work.
3. Server decides what to do based on current run state and `multitask_strategy`:
   - `message` is null AND a run already exists → no-op; respond with current status.
   - `multitask_strategy: reject` AND a run is in flight → `409 Conflict`.
   - `multitask_strategy: interrupt` AND a run is in flight → interrupt the SDK, clear the queue, enqueue this one.
   - Otherwise → mint a `run_id`, enqueue.
4. Server returns immediately with `{entity_ref, run_id, status, accepted}`. Client renders progress via Convex reactivity.
5. Worker pops the item:
   1. Reads `agenticRuns` from Convex for this entity_ref.
   2. If no run exists: `TodoistTaskSource` fetches the canonical task row → starts a new SDK session → writes `agenticRuns` with status `discovering`, the opaque `resume_cursor`, `last_run_id`, and `last_traceparent`.
   3. If a run exists with `message`: SDK resumes the session via `resume_cursor` and feeds the message.
6. As the SDK stream emits events, the server normalizes each into the canonical event taxonomy and writes to Convex, stamping every row with the current `run_id`. Terminal-yield rows also receive a `checkpoint_id`.
7. On a terminal event (proposal, execution result, error, blocked): server updates `agenticRuns.status`, fires the `webhook` if one was supplied, and the worker loop pops the next queued item.

## HTTP API

All endpoints require `Authorization: Bearer <shared_secret>`. All bodies and responses are JSON.

### Common headers

| Header | Required | Purpose |
|--------|----------|---------|
| `Authorization: Bearer <token>` | yes | Shared secret from 1Password. |
| `Idempotency-Key: <string>` | optional | Caller-supplied dedupe key. ≤256 chars. See "Idempotency" below. |
| `traceparent: <w3c-traceparent>` | optional | W3C trace context. Stored on the run row and propagated to log lines. |
| `tracestate: <w3c-tracestate>` | optional | Companion to `traceparent`. |

### Idempotency

Inspired by Trigger.dev's two-layer model:

- **Request-level**: the server caches the (status code + response body) of any `POST` carrying `Idempotency-Key` for **24 hours** keyed by `(idempotency_key, entity_ref, route)`. A retry within that window returns the cached response without re-enqueueing work.
- **Run-level**: if `Idempotency-Key` matches a run already in flight or already terminal, the response returns the existing `run_id` and current status rather than starting a new run.

Without `Idempotency-Key`, requests are not deduplicated and the caller takes responsibility for at-most-once semantics.

### `POST /run`

Kick off (or continue) an agentic run for an entity. Async — returns immediately with `run_id` + current status; clients render progress via Convex.

Request body:

```json
{
  "entity_ref": "todoist:task:7218390471",
  "message": null,
  "multitask_strategy": "enqueue",
  "webhook": null,
  "webhook_token": null
}
```

| Field | Type | Notes |
|-------|------|-------|
| `entity_ref` | string, required | Source URI for the entity. |
| `message` | string \| null | Free text, `EXECUTE: <id>`, `EXECUTE: <id>: <text>`, or `MODIFY: <id>: <text>`. Null on first call. |
| `multitask_strategy` | enum, optional, default `enqueue` | How to behave when a run is already in flight for this entity. See below. |
| `webhook` | string \| null, optional | URL the server will `POST` the terminal `ThreadMessage` to when this run completes. |
| `webhook_token` | string \| null, optional | Bearer token the server will send on the webhook callback so the receiver can verify origin. |

`message` conventions:

- `EXECUTE: <option_id>` — execute a proposed option from the latest proposal.
- `EXECUTE: <option_id>: <modification>` — execute with caller-provided modification.
- `MODIFY: <option_id>: <text>` — request a modified version of an option, treated as discovery input.
- Any other text — discovery input / clarification.

`multitask_strategy` (LangGraph-derived, scoped to our queue semantics):

- `enqueue` (default) — append to the per-entity queue; serialize behind in-flight work.
- `interrupt` — call `interrupt()` on the in-flight run, drop any other queued items, then run this one. Use when a user clicks `EXECUTE:` and wants the agent to stop thinking.
- `reject` — return `409 Conflict` with current status if a run is in flight; do not enqueue.

Response (immediate):

```json
{
  "entity_ref": "todoist:task:7218390471",
  "run_id": "01HXKE5...",
  "status": "discovering",
  "accepted": true
}
```

- `run_id` is a server-assigned ULID identifying this specific invocation. Distinct from `entity_ref` (which is the long-lived thread key). Persisted on `agenticRuns.last_run_id` and stamped onto every `agenticThreadMessages` / `agenticThreadActivities` row produced by this run, so clients can group "this turn's items."
- `accepted: false` if the request was a no-op (null message against an existing run, or `multitask_strategy: reject` while busy).

### `POST /run/:entity_ref/wait`

Long-poll variant of `POST /run`. Same request body. Server blocks until the run reaches a terminal state (`awaiting_decision`, terminal `execution_result`, or `error`), then returns the final `ThreadMessage` row. Default timeout 90s; `?timeout_seconds=N` overrides.

For non-Convex clients (curl scripts, iOS Shortcuts, future Slack one-shots). Convex-resident clients should prefer `POST /run` + reactive queries.

Response on terminal:

```json
{
  "entity_ref": "todoist:task:7218390471",
  "run_id": "01HXKE5...",
  "status": "awaiting_decision",
  "terminal_message": { /* the agenticThreadMessages row */ }
}
```

Response on timeout: `408 Request Timeout` with the current (non-terminal) status. Caller may retry.

### `GET /run/:entity_ref`

Cached read — never invokes the SDK. Returns the last known thread state for an entity. Intended for non-Convex clients.

```json
{
  "entity_ref": "todoist:task:7218390471",
  "run_id": "01HXKE5...",
  "status": "awaiting_decision",
  "last_proposal": { ... },
  "updated_at": "2026-05-15T16:30:14Z"
}
```

### `GET /run/:entity_ref/status`

Lightweight introspection. Returns `idle | discovering | awaiting_decision | executing | error`, the in-flight `run_id` and start time if any, and the resume cursor's logical position (turn count). Used by UI spinners and queue health checks.

### `POST /run/:entity_ref/interrupt`

Cancels any in-flight work for an entity: clears the per-entity queue and calls the SDK's `interrupt`. Idempotent. Returns the resulting status. Functionally equivalent to `POST /run` with `multitask_strategy: interrupt` and `message: null`.

### Webhook callback shape

When a run with a `webhook` field completes, the server `POST`s to that URL with:

```json
{
  "entity_ref": "todoist:task:7218390471",
  "run_id": "01HXKE5...",
  "status": "awaiting_decision",
  "terminal_message": { /* the agenticThreadMessages row */ }
}
```

The originating `POST /run` may include a `webhook_token` field alongside `webhook`. If present, the server includes `Authorization: Bearer <webhook_token>` on the outbound callback so the receiver can verify origin. The server never forwards its own inbound bearer to third parties. At most three retries on non-2xx response with exponential backoff. Webhook delivery is best-effort; clients should reconcile via Convex if it matters.

### `GET /healthz`

Returns process uptime, in-flight session count, last error timestamp, Convex client status. Used by external monitors.

## Client capabilities (informational)

The server exposes a deliberately narrow HTTP surface. Almost all client UX is read from Convex reactive queries — the server's only job on the client-facing side is accepting writes (`POST /run`) and producing them (rows into Convex tables). Recording the building blocks this enables, even though clients are out of scope of this spec:

- **Per-entity thread view** — chat-style transcript rendered from `agenticThreadMessages` interleaved with `agenticThreadActivities` by `sequence`. Markdown prose, collapsible tool-call cards. No length cap on assistant messages.
- **Decision UI** — buttons rendered from the latest `proposal_json.options[]`; recommended option highlighted; free-text reply box when `free_text_allowed`. Clicking a button POSTs `EXECUTE: <option_id>` (or `MODIFY: <option_id>: <text>`) to `/run`.
- **Live "thinking" state** — Convex reactivity streams new rows as they arrive. Reasoning blocks → tool calls → assistant message → proposal appear in sequence.
- **Interrupt** — `POST /run/:entity_ref/interrupt` clears the per-entity queue and aborts the in-flight SDK call.
- **Burndown queue** — clients query `agenticRuns` where `status = "awaiting_decision"`, ordered by `updated_at desc`. Mixed entity types in one queue. Keyboard-driven nav is feasible because everything is queryable.
- **Conversation fork / "try a different option"** — the Claude SDK's `resume_cursor` shape includes `resume_at` (an assistant-message UUID). Clients can request a resume from any historical message; the spec supports this via a future API extension (not v1).
- **Tool-call provenance** — every assistant message can show "based on N tool calls" because `agenticThreadActivities` is queryable per-entity. Cheap antidote to confabulation.
- **Cost / token meter** — each `agenticThreadMessages` row carries `token_usage`; clients sum per entity for a running cost display.
- **Auto-execute rules** — entirely client-side (or Convex-action-side). A rule like `proposal.confidence > 0.9 && reversibility = trivial` can POST `EXECUTE:` automatically. The server has no concept of rules.
- **Notifications** — a Convex action watching `agenticRuns.status` transitions pings Beeper/Slack/etc. No server involvement.
- **Mobile PWA** — Convex reactive queries work in any browser. The server's HTTPS endpoint is the only thing a phone needs to talk to for sending decisions.

## Canonical event/item taxonomy

Modeled after t3code's `CanonicalItemType` so the wire format is provider-neutral from day one, even though only the Claude SDK adapter exists at launch.

```ts
type ThreadMessageKind =
  | "user_message"
  | "assistant_message"
  | "reasoning"
  | "proposal"
  | "execution_result"
  | "error";

type ActivityKind =
  | "tool_call"
  | "approval_request"
  | "approval_response"
  | "context_compaction";
```

Every SDK event is normalized into either a `ThreadMessage` (renderable as a chat bubble) or an `Activity` (renderable as an inline collapsible card). Sequence numbers interleave both streams in the UI.

### Proposal schema

The structured shape used when `ThreadMessageKind = "proposal"`. Validated with zod before write.

```ts
type Proposal = {
  kind: "clarification" | "proposal" | "execution_result" | "blocked";

  // Prose. Markdown. No length limit. The full agent thought.
  summary: string;
  findings?: string[];

  options: Array<{
    id: string;
    label: string;
    description: string;
    rationale?: string;
    confidence: number;        // 0..1
    reversibility: "trivial" | "moderate" | "destructive";
    side_effects?: string[];
  }>;

  recommended_option_id?: string;
  free_text_allowed: boolean;
  question?: string;           // when kind = "clarification"
};
```

A turn produces a stream of items: typically reasoning → tool calls → assistant_message → proposal. The final proposal is what gates the next user input.

## Convex schema additions (in master-db)

Three tables added to `master-db/convex/schema.ts`:

### `agenticRuns`

One row per entity_ref. Server's source of truth for whether a session exists.

| Field | Type | Notes |
|-------|------|-------|
| `entity_ref` | string (indexed, unique) | e.g. `todoist:task:7218390471` |
| `entity_type` | string (indexed) | `todoist_task`, future: `gmail_thread` etc. |
| `entity_id` | string | The raw id portion of entity_ref. |
| `backend` | string | `claude_sdk` for now. Future: `codex`, `api_direct`. |
| `resume_cursor` | object (opaque) | Adapter-owned shape. For Claude SDK: `{session_id, resume_at, turn_count, checkpoint_id}`. |
| `status` | string (indexed) | `idle \| discovering \| awaiting_decision \| executing \| error` |
| `last_message_id` | Id&lt;"agenticThreadMessages"&gt; \| null | Convex document id. |
| `last_run_id` | string \| null | ULID of the most recent invocation. |
| `last_traceparent` | string \| null | W3C trace context from the most recent `POST /run`. |
| `updated_at` | number (indexed) | epoch ms |

Convex's built-in `_creationTime` covers the created-at timestamp.

### `agenticThreadMessages`

Append-only thread of human-readable items.

| Field | Type | Notes |
|-------|------|-------|
| `entity_ref` | string | Indexed with `sequence`. |
| `sequence` | number | Monotonic per entity. |
| `run_id` | string | ULID of the invocation that produced this row. Indexed. |
| `kind` | string | `ThreadMessageKind` enum. |
| `body_markdown` | string \| null | For prose kinds. |
| `proposal_json` | object \| null | When `kind = proposal`, the structured Proposal. |
| `error_json` | object \| null | When `kind = error`. |
| `token_usage` | object \| null | `{input, output, cache_read, cache_write}` per Agent SDK reporting. |
| `checkpoint_id` | string \| null | UUID identifying this row as a resumable point. Populated for terminal-yield rows (`proposal`, `execution_result`). Null for intermediate rows. |

`_creationTime` is the timestamp.

`checkpoint_id` reserves the ability to "fork from this message" — a future `POST /run` could carry `from_checkpoint: <id>` to resume the SDK session from that point with a different message. Not exposed in v1, but the field is populated so the data is available when the feature ships.

### `agenticThreadActivities`

Append-only sibling stream of tool calls and other agent activity, sharing the same `sequence` space as messages so UIs can render an interleaved feed.

| Field | Type | Notes |
|-------|------|-------|
| `entity_ref` | string | Indexed with `sequence`. |
| `sequence` | number | Same sequence space as `agenticThreadMessages`. |
| `run_id` | string | ULID of the invocation that produced this row. |
| `kind` | string | `ActivityKind` enum. |
| `name` | string | Tool name, e.g. `convex.query`, `Read`, `Bash`. |
| `input_json` | object | Tool input. |
| `output_json` | object \| null | Tool output once resolved. |
| `status` | string | `pending \| ok \| error` |
| `resolved_at` | number \| null | epoch ms |

Indexes: `by_entity_ref_and_sequence` on both message and activity tables; `by_status_and_updated_at` on `agenticRuns` for queue queries.

## AgentRunner interface

Single interface the server programs against. Day-one implementation is `ClaudeSdkRunner`. Future `CodexRunner`, `ApiDirectRunner`, etc. drop in behind the same surface.

```ts
interface AgentRunner {
  /**
   * Start or resume a session for an entity and run until the next yield point
   * (proposal, clarification, execution_result, error). Emits canonical events
   * as it goes — the server is responsible for persisting them to Convex.
   */
  run(input: {
    entity_ref: string;
    resume_cursor: unknown | null;   // opaque to the server
    entity_payload: unknown;         // from EntitySource
    message: string | null;
    on_event: (e: CanonicalEvent) => Promise<void>;
  }): Promise<{
    resume_cursor: unknown;
    terminal: CanonicalTerminalEvent; // proposal | execution_result | error
  }>;

  /**
   * Cancel an in-flight run for an entity, if any.
   */
  interrupt(entity_ref: string): Promise<void>;
}
```

`ClaudeSdkRunner` wraps `query()` from `@anthropic-ai/claude-agent-sdk`. It owns a `Map<entity_ref, ClaudeSessionContext>` analogous to t3code's adapter, manages the resume cursor's Claude-specific shape (`{session_id, resume_at, turn_count}`), and translates SDK message events into canonical events.

## EntitySource interface

```ts
interface EntitySource<TPayload> {
  /**
   * Returns the canonical entity payload for a given entity_ref. Throws if not
   * found. May fetch from Convex, a third-party API, or a local cache.
   */
  fetch(entity_ref: string): Promise<TPayload>;
}
```

Day-one implementation: `TodoistTaskSource` — calls a Convex query in master-db to read the task row by id. The skill receives this payload as part of its system prompt context and uses its own tools (Convex, Obsidian, Calendar, etc.) to enrich.

Future sources (`GmailThreadSource`, `BeeperChatSource`, etc.) implement the same interface. Adding a source means: implement `EntitySource`, register in `sources/registry.ts`, optionally specialize the discovery skill.

## Concurrency model

One in-process `Map<entity_ref, Queue<WorkItem>>`. Each entity has its own queue; queues run independently. A `WorkItem` carries `{run_id, message, multitask_strategy, webhook, traceparent}`. When a `/run` arrives:

1. Look up or create the queue for `entity_ref`.
2. Apply `multitask_strategy`:
   - `enqueue` → push to the queue.
   - `interrupt` → call `AgentRunner.interrupt`, clear the queue, push.
   - `reject` → if in-flight or queue non-empty, return `409` without pushing.
3. If the queue isn't currently draining, start the drain loop.

The drain loop pops one item, runs it through `AgentRunner.run`, persists events to Convex (stamped with `run_id`), and loops until empty. Errors caught at the worker boundary write an `error` ThreadMessage and reset `status` to `awaiting_decision` (so the user can decide whether to retry).

`interrupt(entity_ref)` clears the queue and calls `AgentRunner.interrupt`.

This is the same primitive as t3code's per-thread `promptQueue`, just scoped to entity_ref instead of thread id.

### Idempotency cache

A small in-process LRU cache mapping `(idempotency_key, entity_ref, route) → cached_response` with a 24h TTL. Populated on every successful response; consulted at the top of every request. Lost on process restart — fine for v1; callers without retries see no difference.

## Auth & secrets

- Single shared bearer token in 1Password at `op://Sol/agentic-engine/server_token`. Loaded at boot via `op read`. Rotated by regenerating the secret and restarting the process.
- Convex deploy key in 1Password at `op://Sol/agentic-engine/convex_deploy_key`.
- Anthropic API key is consumed by the Claude SDK from the host's `~/.claude` auth state — no key in env. Process must run as a user with valid `claude login`.
- Cloudflare Tunnel public hostname is the only ingress; no other port exposed.

## Forensic shadow log

Independent of CC's own JSONL pruning, the server appends every raw SDK event to `~/.agentic-engine/logs/<entity_ref>.ndjson`. Cheap insurance against any later need to reconstruct a session beyond what Convex projections preserve. Rotated by date; no automatic eviction in v1.

## Lifecycle / deployment

- `bun run start` boots the server on a configurable port.
- `launchd` plist (`~/Library/LaunchAgents/com.milad.agentic-engine.plist`) keeps the process alive across reboots and restarts on crash.
- Cloudflare Tunnel runs as a separate `launchd` agent.
- Logs to stdout (captured by launchd) and to per-entity NDJSON.
- No PID file required — launchd owns the process.

## Testing

- **Unit tests:** event taxonomy normalizer, proposal schema validation, EntitySource registry dispatch, per-entity queue ordering. Vitest, no network.
- **Integration tests:** server with a mock `AgentRunner` (`EchoRunner` returning a canned event stream) + a mock Convex client. End-to-end `/run` calls produce the expected message/activity rows.
- **Manual smoke test:** real Claude SDK + real Convex, single Todoist task ref, validate full discovery turn produces a real proposal in Convex.

No tests against live Anthropic API in CI. Manual SDK smoke runs only.

## What is explicitly out of scope for v1

- The discover-and-propose skill itself — content of the skill is its own design effort, not part of the server spec.
- Any client UI — the Todoist web app changes are a separate project.
- Codex adapter, OpenAI adapter, or any non-Claude runner. The interface is shaped to accept them; no code lands in v1.
- Auto-execute logic. Lives in the client / Convex action layer, not the server.
- Notifications (Beeper/Slack). Lives in Convex actions watching status transitions.
- CQRS / event sourcing. The shadow NDJSON log is enough forensic insurance for v1.
- PreCompact / SessionEnd hooks shipping JSONL chunks to Convex. Server's projections to Convex make this lower priority; can be added later if disk pruning becomes an issue.
- Multi-user auth or sharing.

## Open questions

None blocking. Resolved during brainstorming:

- Backend: Claude Agent SDK (not `claude -p`).
- State: master-db's Convex (new tables).
- Concurrency: per-entity in-process queue with `multitask_strategy` per request.
- Re-call without message: return cached proposal.
- Execution: same session, gated by `EXECUTE:` / `MODIFY:` message conventions.
- Network: public HTTPS via Cloudflare Tunnel + bearer auth.
- Idempotency: `Idempotency-Key` header, two-layer dedupe, 24h TTL.
- Observability: W3C `traceparent` propagation; persisted on `agenticRuns`.
- v1 endpoints: `POST /run`, `POST /run/:entity_ref/wait`, `GET /run/:entity_ref`, `GET /run/:entity_ref/status`, `POST /run/:entity_ref/interrupt`, `GET /healthz`.

## References

- **t3code** (`pingdotgg/t3code`) — provider taxonomy, opaque resume cursor, per-thread queue, NDJSON forensic log, CQRS-style projections.
- **LangGraph Platform** (`langchain-ai/langgraph`) — wire-format inspiration: `run_id` separate from `thread_id`, `multitask_strategy`, `wait` long-poll endpoint, per-run `webhook`, addressable checkpoints.
- **Trigger.dev** (`triggerdotdev/trigger.dev`) — two-layer `Idempotency-Key` model (request-level + run-level), W3C `traceparent` passthrough.
- **OpenHands** (`All-Hands-AI/OpenHands`) — explicit "thin proxy, no logic; push side-effects to webhook callbacks" rule for the conversation router.
- **Convex Agent** (`get-convex/agent`) — direct prior art on our stack for projecting agent activity into reactive tables.
- **Open SWE** (`langchain-ai/open-swe`) — entity-anchored (GitHub-issue-anchored) agent threads, deterministic entity-to-thread mapping.
- Claude Code session storage internals — append-only JSONL per session, auto-compaction preserves disk file, eventual pruning of old sessions.
- Claude Agent SDK — `@anthropic-ai/claude-agent-sdk`, `query()` API, `SessionStore` abstraction, June 2026 subscription metering.
- **master-db** (`mimen/master-db`) — Convex + Todoist sync, existing data layer this server reads/writes.
