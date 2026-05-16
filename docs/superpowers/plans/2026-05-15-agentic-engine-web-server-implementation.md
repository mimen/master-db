# Agentic Engine Web Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the HTTP server (`engine/`) that wraps the Claude Agent SDK into an async, durable, multi-entity agentic decision-making engine, persists thread/activity events to Convex, and accepts structured user input back.

**Architecture:** Sibling package inside master-db. Hono HTTP server in Bun, talks to master-db's Convex deployment via the typed Convex client, spawns Claude Agent SDK sessions in-process (one per active `entity_ref`), serializes work per entity with an in-process queue.

**Tech Stack:** Bun, TypeScript (strict), Hono, zod, `@anthropic-ai/claude-agent-sdk`, `convex` client, `ulid`, `lru-cache`, vitest. Existing master-db conventions: per-service Convex layout, `bun --cwd <pkg>` for package-scoped commands, TDD with `*.test.ts` co-located.

**Spec:** `docs/superpowers/specs/2026-05-15-agentic-engine-web-server-design.md`. Read it before starting any task.

**Validation commands (run after every code change before commit):**
```bash
bun run typecheck && bun run lint && bun test
```

---

## File Structure

Convex side (master-db's existing per-service pattern):
- `convex/schema/agentic/agenticRuns.ts` — one table definition
- `convex/schema/agentic/agenticThreadMessages.ts` — one table definition
- `convex/schema/agentic/agenticThreadActivities.ts` — one table definition
- `convex/schema/agentic/index.ts` — barrel exporting all three
- `convex/schema.ts` — add `...agentic` to `defineSchema`
- `convex/agentic/types/runStatus.ts` — string-literal enums + zod-validators
- `convex/agentic/mutations/upsertRun.ts` — insert or update an `agenticRuns` row
- `convex/agentic/mutations/appendThreadMessage.ts` — append to messages with monotonic sequence
- `convex/agentic/mutations/recordActivity.ts` — append/resolve activity rows
- `convex/agentic/mutations/updateRunStatus.ts` — flip status, update `last_run_id`/`last_traceparent`
- `convex/agentic/queries/getRun.ts` — by entity_ref
- `convex/agentic/queries/getThread.ts` — messages+activities by entity_ref
- `convex/agentic/queries/getActivities.ts` — activities by run_id (for debugging)
- `convex/agentic/mutations.ts` — barrel
- `convex/agentic/queries.ts` — barrel
- One `.test.ts` per mutation/query file using `convex-test`

Engine package (new):
- `engine/package.json`
- `engine/tsconfig.json`
- `engine/src/env.ts` — zod-validated env loader
- `engine/src/auth.ts` — Hono bearer middleware
- `engine/src/logging/logger.ts` — JSON line logger
- `engine/src/logging/ndjson.ts` — per-entity shadow log file appender
- `engine/src/runner/types.ts` — `AgentRunner`, canonical event union, terminal event union
- `engine/src/runner/proposalSchema.ts` — zod `Proposal` schema
- `engine/src/runner/echoRunner.ts` — deterministic fake runner for tests
- `engine/src/runner/claudeSdkRunner.ts` — real Claude Agent SDK adapter
- `engine/src/sources/types.ts` — `EntitySource` interface, `entity_ref` parser
- `engine/src/sources/todoistTask.ts` — Todoist source reading from Convex
- `engine/src/sources/registry.ts` — entity_type → source dispatch
- `engine/src/store/convex.ts` — typed wrapper over `ConvexHttpClient`
- `engine/src/concurrency/idempotencyCache.ts` — LRU cache with TTL
- `engine/src/concurrency/perEntityQueue.ts` — `Map<entity_ref, Queue>` with multitask strategies
- `engine/src/webhook/deliver.ts` — outbound POST with retry/backoff
- `engine/src/routes/run.ts` — `POST /run` + `POST /run/:entity_ref/wait`
- `engine/src/routes/readRun.ts` — `GET /run/:entity_ref` + `/status`
- `engine/src/routes/interrupt.ts` — `POST /run/:entity_ref/interrupt`
- `engine/src/routes/health.ts` — `GET /healthz`
- `engine/src/server.ts` — Hono app assembling the above
- Each module gets a co-located `*.test.ts` file
- `engine/test/integration.test.ts` — end-to-end test using `EchoRunner` + mock Convex
- One-off operational artifacts (committed but not part of code path):
  - `engine/deploy/com.milad.agentic-engine.plist` — launchd template
  - `engine/deploy/cloudflared.yml.example` — tunnel config example
  - `engine/README.md` — bring-up notes

---

## Task 1: Clone master-db locally and orient

The repo lives at `~/Documents/GitHub/master-db` after the spec was committed. If it's missing, `gh repo clone mimen/master-db ~/Documents/GitHub/master-db` first.

**Files:**
- Verify: `~/Documents/GitHub/master-db/{package.json, convex/schema.ts, app/, CLAUDE.md}`

- [ ] **Step 1: Confirm working directory and existing layout**

```bash
cd ~/Documents/GitHub/master-db
ls
cat CLAUDE.md | head -50
```

Expected: see `app/`, `convex/`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `CLAUDE.md`.

- [ ] **Step 2: Confirm baseline checks pass**

```bash
bun install
bun run typecheck && bun run lint && bun test
```

Expected: all three pass before we add anything.

- [ ] **Step 3: Read the spec end-to-end**

```bash
open docs/superpowers/specs/2026-05-15-agentic-engine-web-server-design.md
```

Required reading before starting Task 2.

---

## Task 2: Add `agentic` schema tables to Convex

**Files:**
- Create: `convex/schema/agentic/agenticRuns.ts`
- Create: `convex/schema/agentic/agenticThreadMessages.ts`
- Create: `convex/schema/agentic/agenticThreadActivities.ts`
- Create: `convex/schema/agentic/index.ts`
- Modify: `convex/schema.ts`
- Test: `convex/schema/agentic/schema.test.ts`

- [ ] **Step 1: Write the failing schema integration test**

`convex/schema/agentic/schema.test.ts`:
```ts
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../../schema";

describe("agentic schema", () => {
  test("inserts and reads back an agenticRuns row", async () => {
    const t = convexTest(schema);
    const id = await t.run(async (ctx) => {
      return ctx.db.insert("agenticRuns", {
        entity_ref: "todoist:task:abc",
        entity_type: "todoist_task",
        entity_id: "abc",
        backend: "claude_sdk",
        resume_cursor: null,
        status: "idle",
        last_message_id: null,
        last_run_id: null,
        last_traceparent: null,
        updated_at: Date.now(),
      });
    });
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.entity_ref).toBe("todoist:task:abc");
  });

  test("inserts an agenticThreadMessages row with checkpoint_id", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("agenticThreadMessages", {
        entity_ref: "todoist:task:abc",
        sequence: 1,
        run_id: "01HXKE5",
        kind: "proposal",
        body_markdown: null,
        proposal_json: { kind: "proposal", summary: "x", options: [], free_text_allowed: true },
        error_json: null,
        token_usage: null,
        checkpoint_id: "11111111-1111-1111-1111-111111111111",
      });
    });
  });

  test("inserts an agenticThreadActivities row", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("agenticThreadActivities", {
        entity_ref: "todoist:task:abc",
        sequence: 2,
        run_id: "01HXKE5",
        kind: "tool_call",
        name: "Read",
        input_json: { path: "/x" },
        output_json: null,
        status: "pending",
        resolved_at: null,
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test convex/schema/agentic/schema.test.ts
```

Expected: FAIL — `Cannot read properties of undefined (reading 'agenticRuns')` or schema unknown table.

- [ ] **Step 3: Create the three table definitions**

`convex/schema/agentic/agenticRuns.ts`:
```ts
import { defineTable } from "convex/server";
import { v } from "convex/values";

export const agenticRuns = defineTable({
  entity_ref: v.string(),
  entity_type: v.string(),
  entity_id: v.string(),
  backend: v.string(),
  resume_cursor: v.union(v.object({}), v.null()),
  status: v.string(),
  last_message_id: v.union(v.id("agenticThreadMessages"), v.null()),
  last_run_id: v.union(v.string(), v.null()),
  last_traceparent: v.union(v.string(), v.null()),
  updated_at: v.number(),
})
  .index("by_entity_ref", ["entity_ref"])
  .index("by_entity_type", ["entity_type"])
  .index("by_status_and_updated_at", ["status", "updated_at"]);
```

`convex/schema/agentic/agenticThreadMessages.ts`:
```ts
import { defineTable } from "convex/server";
import { v } from "convex/values";

export const agenticThreadMessages = defineTable({
  entity_ref: v.string(),
  sequence: v.number(),
  run_id: v.string(),
  kind: v.string(),
  body_markdown: v.union(v.string(), v.null()),
  proposal_json: v.union(v.any(), v.null()),
  error_json: v.union(v.any(), v.null()),
  token_usage: v.union(v.any(), v.null()),
  checkpoint_id: v.union(v.string(), v.null()),
})
  .index("by_entity_ref_and_sequence", ["entity_ref", "sequence"])
  .index("by_run_id", ["run_id"])
  .index("by_checkpoint_id", ["checkpoint_id"]);
```

`convex/schema/agentic/agenticThreadActivities.ts`:
```ts
import { defineTable } from "convex/server";
import { v } from "convex/values";

export const agenticThreadActivities = defineTable({
  entity_ref: v.string(),
  sequence: v.number(),
  run_id: v.string(),
  kind: v.string(),
  name: v.string(),
  input_json: v.any(),
  output_json: v.union(v.any(), v.null()),
  status: v.string(),
  resolved_at: v.union(v.number(), v.null()),
})
  .index("by_entity_ref_and_sequence", ["entity_ref", "sequence"])
  .index("by_run_id", ["run_id"]);
```

`convex/schema/agentic/index.ts`:
```ts
export { agenticRuns } from "./agenticRuns";
export { agenticThreadMessages } from "./agenticThreadMessages";
export { agenticThreadActivities } from "./agenticThreadActivities";
```

- [ ] **Step 4: Wire into the top-level schema**

Edit `convex/schema.ts` to add the import + spread:

```ts
import * as agentic from "./schema/agentic";

export default defineSchema({
  ...todoist,
  ...routines,
  ...agentic,
  sync_state,
});
```

- [ ] **Step 5: Run test to verify it passes**

```bash
bun test convex/schema/agentic/schema.test.ts
```

Expected: PASS.

- [ ] **Step 6: Validate full repo**

```bash
bun run typecheck && bun run lint && bun test
```

Expected: all pass. Convex codegen runs as part of typecheck via `bunx convex dev` may be needed first — if typecheck errors mention missing `_generated`, run `bunx convex dev --once` first.

- [ ] **Step 7: Commit**

```bash
git add convex/schema/agentic convex/schema.ts
git commit -m "feat(convex): add agentic schema tables"
```

---

## Task 3: Add Convex types module for status enums

**Files:**
- Create: `convex/agentic/types/runStatus.ts`
- Test: `convex/agentic/types/runStatus.test.ts`

- [ ] **Step 1: Write the failing test**

`convex/agentic/types/runStatus.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import {
  isRunStatus,
  isThreadMessageKind,
  isActivityKind,
  RUN_STATUSES,
} from "./runStatus";

describe("agentic enums", () => {
  test("isRunStatus accepts canonical values", () => {
    expect(isRunStatus("idle")).toBe(true);
    expect(isRunStatus("awaiting_decision")).toBe(true);
    expect(isRunStatus("nope")).toBe(false);
  });

  test("isThreadMessageKind", () => {
    expect(isThreadMessageKind("proposal")).toBe(true);
    expect(isThreadMessageKind("garbage")).toBe(false);
  });

  test("isActivityKind", () => {
    expect(isActivityKind("tool_call")).toBe(true);
    expect(isActivityKind("garbage")).toBe(false);
  });

  test("RUN_STATUSES is exhaustive and read-only", () => {
    expect(RUN_STATUSES).toEqual([
      "idle",
      "discovering",
      "awaiting_decision",
      "executing",
      "error",
    ]);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
bun test convex/agentic/types/runStatus.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the enums**

`convex/agentic/types/runStatus.ts`:
```ts
export const RUN_STATUSES = [
  "idle",
  "discovering",
  "awaiting_decision",
  "executing",
  "error",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const isRunStatus = (s: string): s is RunStatus =>
  (RUN_STATUSES as readonly string[]).includes(s);

export const THREAD_MESSAGE_KINDS = [
  "user_message",
  "assistant_message",
  "reasoning",
  "proposal",
  "execution_result",
  "error",
] as const;
export type ThreadMessageKind = (typeof THREAD_MESSAGE_KINDS)[number];
export const isThreadMessageKind = (s: string): s is ThreadMessageKind =>
  (THREAD_MESSAGE_KINDS as readonly string[]).includes(s);

export const ACTIVITY_KINDS = [
  "tool_call",
  "approval_request",
  "approval_response",
  "context_compaction",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export const isActivityKind = (s: string): s is ActivityKind =>
  (ACTIVITY_KINDS as readonly string[]).includes(s);
```

- [ ] **Step 4: Verify test passes and commit**

```bash
bun test convex/agentic/types/runStatus.test.ts
bun run typecheck && bun run lint
git add convex/agentic/types
git commit -m "feat(convex): add agentic status enum types"
```

---

## Task 4: Convex mutation — upsertRun

**Files:**
- Create: `convex/agentic/mutations/upsertRun.ts`
- Test: `convex/agentic/mutations/upsertRun.test.ts`

- [ ] **Step 1: Write the failing test**

`convex/agentic/mutations/upsertRun.test.ts`:
```ts
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../../schema";
import { api } from "../../_generated/api";

describe("upsertRun", () => {
  test("creates a new row when none exists", async () => {
    const t = convexTest(schema);
    const id = await t.mutation(api.agentic.mutations.upsertRun.default, {
      entity_ref: "todoist:task:abc",
      entity_type: "todoist_task",
      entity_id: "abc",
      backend: "claude_sdk",
      status: "discovering",
      run_id: "01H1",
      traceparent: null,
      resume_cursor: null,
    });
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.entity_ref).toBe("todoist:task:abc");
    expect(row?.status).toBe("discovering");
    expect(row?.last_run_id).toBe("01H1");
  });

  test("updates the existing row when one exists", async () => {
    const t = convexTest(schema);
    await t.mutation(api.agentic.mutations.upsertRun.default, {
      entity_ref: "todoist:task:abc",
      entity_type: "todoist_task",
      entity_id: "abc",
      backend: "claude_sdk",
      status: "discovering",
      run_id: "01H1",
      traceparent: null,
      resume_cursor: null,
    });
    await t.mutation(api.agentic.mutations.upsertRun.default, {
      entity_ref: "todoist:task:abc",
      entity_type: "todoist_task",
      entity_id: "abc",
      backend: "claude_sdk",
      status: "awaiting_decision",
      run_id: "01H2",
      traceparent: "00-trace-span-01",
      resume_cursor: { session_id: "abc" },
    });
    const all = await t.run(async (ctx) =>
      ctx.db.query("agenticRuns").collect()
    );
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("awaiting_decision");
    expect(all[0].last_run_id).toBe("01H2");
    expect(all[0].last_traceparent).toBe("00-trace-span-01");
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
bun test convex/agentic/mutations/upsertRun.test.ts
```

Expected: FAIL — `api.agentic.mutations.upsertRun` doesn't exist.

- [ ] **Step 3: Implement the mutation**

`convex/agentic/mutations/upsertRun.ts`:
```ts
import { v } from "convex/values";
import { mutation } from "../../_generated/server";

export default mutation({
  args: {
    entity_ref: v.string(),
    entity_type: v.string(),
    entity_id: v.string(),
    backend: v.string(),
    status: v.string(),
    run_id: v.string(),
    traceparent: v.union(v.string(), v.null()),
    resume_cursor: v.union(v.object({}), v.null()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agenticRuns")
      .withIndex("by_entity_ref", (q) => q.eq("entity_ref", args.entity_ref))
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        last_run_id: args.run_id,
        last_traceparent: args.traceparent,
        resume_cursor: args.resume_cursor,
        updated_at: now,
      });
      return existing._id;
    }
    return ctx.db.insert("agenticRuns", {
      entity_ref: args.entity_ref,
      entity_type: args.entity_type,
      entity_id: args.entity_id,
      backend: args.backend,
      status: args.status,
      last_run_id: args.run_id,
      last_traceparent: args.traceparent,
      last_message_id: null,
      resume_cursor: args.resume_cursor,
      updated_at: now,
    });
  },
});
```

- [ ] **Step 4: Reload Convex dev server**

```bash
bunx convex dev --once
```

- [ ] **Step 5: Verify test passes**

```bash
bun test convex/agentic/mutations/upsertRun.test.ts
bun run typecheck && bun run lint
```

- [ ] **Step 6: Commit**

```bash
git add convex/agentic/mutations/upsertRun.ts convex/agentic/mutations/upsertRun.test.ts
git commit -m "feat(convex): add upsertRun mutation"
```

---

## Task 5: Convex mutation — appendThreadMessage

**Files:**
- Create: `convex/agentic/mutations/appendThreadMessage.ts`
- Test: `convex/agentic/mutations/appendThreadMessage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../../schema";
import { api } from "../../_generated/api";

describe("appendThreadMessage", () => {
  test("assigns monotonic sequence per entity", async () => {
    const t = convexTest(schema);
    const id1 = await t.mutation(api.agentic.mutations.appendThreadMessage.default, {
      entity_ref: "todoist:task:abc",
      run_id: "01H1",
      kind: "user_message",
      body_markdown: "hi",
      proposal_json: null,
      error_json: null,
      token_usage: null,
      checkpoint_id: null,
    });
    const id2 = await t.mutation(api.agentic.mutations.appendThreadMessage.default, {
      entity_ref: "todoist:task:abc",
      run_id: "01H1",
      kind: "assistant_message",
      body_markdown: "hello back",
      proposal_json: null,
      error_json: null,
      token_usage: null,
      checkpoint_id: null,
    });
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("agenticThreadMessages")
        .withIndex("by_entity_ref_and_sequence", (q) =>
          q.eq("entity_ref", "todoist:task:abc")
        )
        .collect()
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]._id).toBe(id1);
    expect(rows[0].sequence).toBe(1);
    expect(rows[1]._id).toBe(id2);
    expect(rows[1].sequence).toBe(2);
  });

  test("separate entities have independent sequences", async () => {
    const t = convexTest(schema);
    await t.mutation(api.agentic.mutations.appendThreadMessage.default, {
      entity_ref: "todoist:task:abc",
      run_id: "01H1",
      kind: "user_message",
      body_markdown: "x",
      proposal_json: null,
      error_json: null,
      token_usage: null,
      checkpoint_id: null,
    });
    await t.mutation(api.agentic.mutations.appendThreadMessage.default, {
      entity_ref: "todoist:task:xyz",
      run_id: "01H2",
      kind: "user_message",
      body_markdown: "y",
      proposal_json: null,
      error_json: null,
      token_usage: null,
      checkpoint_id: null,
    });
    const abc = await t.run(async (ctx) =>
      ctx.db
        .query("agenticThreadMessages")
        .withIndex("by_entity_ref_and_sequence", (q) =>
          q.eq("entity_ref", "todoist:task:abc")
        )
        .collect()
    );
    const xyz = await t.run(async (ctx) =>
      ctx.db
        .query("agenticThreadMessages")
        .withIndex("by_entity_ref_and_sequence", (q) =>
          q.eq("entity_ref", "todoist:task:xyz")
        )
        .collect()
    );
    expect(abc[0].sequence).toBe(1);
    expect(xyz[0].sequence).toBe(1);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
bun test convex/agentic/mutations/appendThreadMessage.test.ts
```

- [ ] **Step 3: Implement**

`convex/agentic/mutations/appendThreadMessage.ts`:
```ts
import { v } from "convex/values";
import { mutation } from "../../_generated/server";

export default mutation({
  args: {
    entity_ref: v.string(),
    run_id: v.string(),
    kind: v.string(),
    body_markdown: v.union(v.string(), v.null()),
    proposal_json: v.union(v.any(), v.null()),
    error_json: v.union(v.any(), v.null()),
    token_usage: v.union(v.any(), v.null()),
    checkpoint_id: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const last = await ctx.db
      .query("agenticThreadMessages")
      .withIndex("by_entity_ref_and_sequence", (q) =>
        q.eq("entity_ref", args.entity_ref)
      )
      .order("desc")
      .first();
    const sequence = (last?.sequence ?? 0) + 1;
    return ctx.db.insert("agenticThreadMessages", { ...args, sequence });
  },
});
```

- [ ] **Step 4: Verify and commit**

```bash
bunx convex dev --once
bun test convex/agentic/mutations/appendThreadMessage.test.ts
bun run typecheck && bun run lint
git add convex/agentic/mutations/appendThreadMessage.ts convex/agentic/mutations/appendThreadMessage.test.ts
git commit -m "feat(convex): add appendThreadMessage mutation"
```

---

## Task 6: Convex mutation — recordActivity (with resolve update)

**Files:**
- Create: `convex/agentic/mutations/recordActivity.ts`
- Test: `convex/agentic/mutations/recordActivity.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../../schema";
import { api } from "../../_generated/api";

describe("recordActivity", () => {
  test("creates a pending activity and resolves it later", async () => {
    const t = convexTest(schema);
    const id = await t.mutation(api.agentic.mutations.recordActivity.start, {
      entity_ref: "todoist:task:abc",
      run_id: "01H1",
      kind: "tool_call",
      name: "Read",
      input_json: { path: "/x" },
    });
    const pending = await t.run(async (ctx) => ctx.db.get(id));
    expect(pending?.status).toBe("pending");
    expect(pending?.output_json).toBeNull();
    expect(pending?.sequence).toBe(1);

    await t.mutation(api.agentic.mutations.recordActivity.resolve, {
      id,
      status: "ok",
      output_json: { content: "hello" },
    });
    const resolved = await t.run(async (ctx) => ctx.db.get(id));
    expect(resolved?.status).toBe("ok");
    expect(resolved?.output_json).toEqual({ content: "hello" });
    expect(resolved?.resolved_at).toBeTypeOf("number");
  });

  test("activity sequences share space with messages per entity", async () => {
    const t = convexTest(schema);
    await t.mutation(api.agentic.mutations.appendThreadMessage.default, {
      entity_ref: "todoist:task:abc",
      run_id: "01H1",
      kind: "assistant_message",
      body_markdown: "x",
      proposal_json: null,
      error_json: null,
      token_usage: null,
      checkpoint_id: null,
    });
    await t.mutation(api.agentic.mutations.recordActivity.start, {
      entity_ref: "todoist:task:abc",
      run_id: "01H1",
      kind: "tool_call",
      name: "Read",
      input_json: {},
    });
    const acts = await t.run(async (ctx) =>
      ctx.db
        .query("agenticThreadActivities")
        .withIndex("by_entity_ref_and_sequence", (q) =>
          q.eq("entity_ref", "todoist:task:abc")
        )
        .collect()
    );
    expect(acts[0].sequence).toBe(2);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

- [ ] **Step 3: Implement**

`convex/agentic/mutations/recordActivity.ts`:
```ts
import { v } from "convex/values";
import { mutation } from "../../_generated/server";

async function nextSequence(
  ctx: { db: { query: (t: "agenticThreadMessages" | "agenticThreadActivities") => any } },
  entity_ref: string,
) {
  const lastMsg = await ctx.db
    .query("agenticThreadMessages")
    .withIndex("by_entity_ref_and_sequence", (q: any) =>
      q.eq("entity_ref", entity_ref)
    )
    .order("desc")
    .first();
  const lastAct = await ctx.db
    .query("agenticThreadActivities")
    .withIndex("by_entity_ref_and_sequence", (q: any) =>
      q.eq("entity_ref", entity_ref)
    )
    .order("desc")
    .first();
  return Math.max(lastMsg?.sequence ?? 0, lastAct?.sequence ?? 0) + 1;
}

export const start = mutation({
  args: {
    entity_ref: v.string(),
    run_id: v.string(),
    kind: v.string(),
    name: v.string(),
    input_json: v.any(),
  },
  handler: async (ctx, args) => {
    const sequence = await nextSequence(ctx, args.entity_ref);
    return ctx.db.insert("agenticThreadActivities", {
      ...args,
      sequence,
      output_json: null,
      status: "pending",
      resolved_at: null,
    });
  },
});

export const resolve = mutation({
  args: {
    id: v.id("agenticThreadActivities"),
    status: v.string(),
    output_json: v.union(v.any(), v.null()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: args.status,
      output_json: args.output_json,
      resolved_at: Date.now(),
    });
  },
});
```

NOTE: `appendThreadMessage` in Task 5 was implemented before this sequence-sharing rule was clear. Update it now to use the shared `nextSequence` helper instead of only looking at message rows.

`convex/agentic/mutations/appendThreadMessage.ts` becomes:
```ts
import { v } from "convex/values";
import { mutation } from "../../_generated/server";

export default mutation({
  args: {
    entity_ref: v.string(),
    run_id: v.string(),
    kind: v.string(),
    body_markdown: v.union(v.string(), v.null()),
    proposal_json: v.union(v.any(), v.null()),
    error_json: v.union(v.any(), v.null()),
    token_usage: v.union(v.any(), v.null()),
    checkpoint_id: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const lastMsg = await ctx.db
      .query("agenticThreadMessages")
      .withIndex("by_entity_ref_and_sequence", (q) =>
        q.eq("entity_ref", args.entity_ref)
      )
      .order("desc")
      .first();
    const lastAct = await ctx.db
      .query("agenticThreadActivities")
      .withIndex("by_entity_ref_and_sequence", (q) =>
        q.eq("entity_ref", args.entity_ref)
      )
      .order("desc")
      .first();
    const sequence =
      Math.max(lastMsg?.sequence ?? 0, lastAct?.sequence ?? 0) + 1;
    return ctx.db.insert("agenticThreadMessages", { ...args, sequence });
  },
});
```

Update `appendThreadMessage.test.ts` if any sequence expectations break — they shouldn't, since both tests inserted no activities.

- [ ] **Step 4: Verify and commit**

```bash
bunx convex dev --once
bun test convex/agentic/mutations/recordActivity.test.ts convex/agentic/mutations/appendThreadMessage.test.ts
bun run typecheck && bun run lint
git add convex/agentic/mutations/recordActivity.ts convex/agentic/mutations/recordActivity.test.ts convex/agentic/mutations/appendThreadMessage.ts
git commit -m "feat(convex): add recordActivity mutation, share sequence with messages"
```

---

## Task 7: Convex mutation — updateRunStatus

**Files:**
- Create: `convex/agentic/mutations/updateRunStatus.ts`
- Test: `convex/agentic/mutations/updateRunStatus.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../../schema";
import { api } from "../../_generated/api";

describe("updateRunStatus", () => {
  test("patches status and last_message_id", async () => {
    const t = convexTest(schema);
    await t.mutation(api.agentic.mutations.upsertRun.default, {
      entity_ref: "todoist:task:abc",
      entity_type: "todoist_task",
      entity_id: "abc",
      backend: "claude_sdk",
      status: "discovering",
      run_id: "01H1",
      traceparent: null,
      resume_cursor: null,
    });
    const msgId = await t.mutation(api.agentic.mutations.appendThreadMessage.default, {
      entity_ref: "todoist:task:abc",
      run_id: "01H1",
      kind: "proposal",
      body_markdown: null,
      proposal_json: { kind: "proposal", summary: "x", options: [], free_text_allowed: true },
      error_json: null,
      token_usage: null,
      checkpoint_id: "ck1",
    });
    await t.mutation(api.agentic.mutations.updateRunStatus.default, {
      entity_ref: "todoist:task:abc",
      status: "awaiting_decision",
      last_message_id: msgId,
      resume_cursor: { session_id: "s" },
    });
    const row = await t.run(async (ctx) =>
      ctx.db
        .query("agenticRuns")
        .withIndex("by_entity_ref", (q) => q.eq("entity_ref", "todoist:task:abc"))
        .unique()
    );
    expect(row?.status).toBe("awaiting_decision");
    expect(row?.last_message_id).toBe(msgId);
    expect(row?.resume_cursor).toEqual({ session_id: "s" });
  });

  test("throws if no run exists", async () => {
    const t = convexTest(schema);
    await expect(
      t.mutation(api.agentic.mutations.updateRunStatus.default, {
        entity_ref: "missing",
        status: "error",
        last_message_id: null,
        resume_cursor: null,
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

- [ ] **Step 3: Implement**

`convex/agentic/mutations/updateRunStatus.ts`:
```ts
import { v } from "convex/values";
import { mutation } from "../../_generated/server";

export default mutation({
  args: {
    entity_ref: v.string(),
    status: v.string(),
    last_message_id: v.union(v.id("agenticThreadMessages"), v.null()),
    resume_cursor: v.union(v.object({}), v.null()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agenticRuns")
      .withIndex("by_entity_ref", (q) => q.eq("entity_ref", args.entity_ref))
      .unique();
    if (!existing) {
      throw new Error(`No agenticRuns row for entity_ref=${args.entity_ref}`);
    }
    await ctx.db.patch(existing._id, {
      status: args.status,
      last_message_id: args.last_message_id,
      resume_cursor: args.resume_cursor,
      updated_at: Date.now(),
    });
  },
});
```

- [ ] **Step 4: Verify and commit**

```bash
bunx convex dev --once
bun test convex/agentic/mutations/updateRunStatus.test.ts
bun run typecheck && bun run lint
git add convex/agentic/mutations/updateRunStatus.ts convex/agentic/mutations/updateRunStatus.test.ts
git commit -m "feat(convex): add updateRunStatus mutation"
```

---

## Task 8: Convex queries — getRun, getThread, getActivities

**Files:**
- Create: `convex/agentic/queries/getRun.ts`
- Create: `convex/agentic/queries/getThread.ts`
- Create: `convex/agentic/queries/getActivities.ts`
- Test: `convex/agentic/queries/queries.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../../schema";
import { api } from "../../_generated/api";

async function seed(t: ReturnType<typeof convexTest>, entity_ref: string) {
  await t.mutation(api.agentic.mutations.upsertRun.default, {
    entity_ref,
    entity_type: "todoist_task",
    entity_id: "x",
    backend: "claude_sdk",
    status: "awaiting_decision",
    run_id: "01H1",
    traceparent: null,
    resume_cursor: null,
  });
  await t.mutation(api.agentic.mutations.appendThreadMessage.default, {
    entity_ref,
    run_id: "01H1",
    kind: "user_message",
    body_markdown: "do the thing",
    proposal_json: null,
    error_json: null,
    token_usage: null,
    checkpoint_id: null,
  });
  await t.mutation(api.agentic.mutations.recordActivity.start, {
    entity_ref,
    run_id: "01H1",
    kind: "tool_call",
    name: "Read",
    input_json: {},
  });
  await t.mutation(api.agentic.mutations.appendThreadMessage.default, {
    entity_ref,
    run_id: "01H1",
    kind: "proposal",
    body_markdown: null,
    proposal_json: { kind: "proposal", summary: "ok", options: [], free_text_allowed: true },
    error_json: null,
    token_usage: null,
    checkpoint_id: "ck1",
  });
}

describe("agentic queries", () => {
  test("getRun returns the row or null", async () => {
    const t = convexTest(schema);
    await seed(t, "todoist:task:abc");
    const r = await t.query(api.agentic.queries.getRun.default, {
      entity_ref: "todoist:task:abc",
    });
    expect(r?.status).toBe("awaiting_decision");
    const missing = await t.query(api.agentic.queries.getRun.default, {
      entity_ref: "todoist:task:none",
    });
    expect(missing).toBeNull();
  });

  test("getThread returns messages and activities interleaved by sequence", async () => {
    const t = convexTest(schema);
    await seed(t, "todoist:task:abc");
    const thread = await t.query(api.agentic.queries.getThread.default, {
      entity_ref: "todoist:task:abc",
    });
    expect(thread.map((x) => x.sequence)).toEqual([1, 2, 3]);
    expect(thread.map((x) => x.row_type)).toEqual([
      "message",
      "activity",
      "message",
    ]);
  });

  test("getActivities filters by run_id", async () => {
    const t = convexTest(schema);
    await seed(t, "todoist:task:abc");
    const acts = await t.query(api.agentic.queries.getActivities.default, {
      run_id: "01H1",
    });
    expect(acts).toHaveLength(1);
    expect(acts[0].name).toBe("Read");
  });
});
```

- [ ] **Step 2: Run test, expect failure**

- [ ] **Step 3: Implement**

`convex/agentic/queries/getRun.ts`:
```ts
import { v } from "convex/values";
import { query } from "../../_generated/server";

export default query({
  args: { entity_ref: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("agenticRuns")
      .withIndex("by_entity_ref", (q) => q.eq("entity_ref", args.entity_ref))
      .unique();
  },
});
```

`convex/agentic/queries/getThread.ts`:
```ts
import { v } from "convex/values";
import { query } from "../../_generated/server";

export default query({
  args: { entity_ref: v.string() },
  handler: async (ctx, args) => {
    const msgs = await ctx.db
      .query("agenticThreadMessages")
      .withIndex("by_entity_ref_and_sequence", (q) =>
        q.eq("entity_ref", args.entity_ref)
      )
      .collect();
    const acts = await ctx.db
      .query("agenticThreadActivities")
      .withIndex("by_entity_ref_and_sequence", (q) =>
        q.eq("entity_ref", args.entity_ref)
      )
      .collect();
    const combined = [
      ...msgs.map((m) => ({ ...m, row_type: "message" as const })),
      ...acts.map((a) => ({ ...a, row_type: "activity" as const })),
    ];
    combined.sort((a, b) => a.sequence - b.sequence);
    return combined;
  },
});
```

`convex/agentic/queries/getActivities.ts`:
```ts
import { v } from "convex/values";
import { query } from "../../_generated/server";

export default query({
  args: { run_id: v.string() },
  handler: async (ctx, args) =>
    ctx.db
      .query("agenticThreadActivities")
      .withIndex("by_run_id", (q) => q.eq("run_id", args.run_id))
      .collect(),
});
```

- [ ] **Step 4: Verify and commit**

```bash
bunx convex dev --once
bun test convex/agentic/queries
bun run typecheck && bun run lint
git add convex/agentic/queries
git commit -m "feat(convex): add agentic queries (getRun, getThread, getActivities)"
```

---

## Task 9: Barrel files for agentic Convex module

**Files:**
- Create: `convex/agentic/mutations.ts`
- Create: `convex/agentic/queries.ts`

- [ ] **Step 1: Create the barrels**

`convex/agentic/mutations.ts`:
```ts
export { default as upsertRun } from "./mutations/upsertRun";
export { default as appendThreadMessage } from "./mutations/appendThreadMessage";
export { default as updateRunStatus } from "./mutations/updateRunStatus";
export * as recordActivity from "./mutations/recordActivity";
```

`convex/agentic/queries.ts`:
```ts
export { default as getRun } from "./queries/getRun";
export { default as getThread } from "./queries/getThread";
export { default as getActivities } from "./queries/getActivities";
```

- [ ] **Step 2: Verify and commit**

```bash
bunx convex dev --once
bun run typecheck && bun run lint && bun test
git add convex/agentic/mutations.ts convex/agentic/queries.ts
git commit -m "feat(convex): add barrel exports for agentic module"
```

---

## Task 10: Bootstrap the `engine/` package

**Files:**
- Create: `engine/package.json`
- Create: `engine/tsconfig.json`
- Create: `engine/src/server.ts` (stub)
- Modify: `package.json` (root) — extend typecheck script

- [ ] **Step 1: Create `engine/package.json`**

```json
{
  "name": "agentic-engine",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "bun src/server.ts",
    "dev": "bun --hot src/server.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.1.0",
    "convex": "^1.29.1",
    "hono": "^4.7.0",
    "lru-cache": "^11.0.0",
    "ulid": "^2.4.0",
    "zod": "^4.1.9"
  },
  "devDependencies": {
    "@types/node": "^24.5.2",
    "typescript": "^5.9.2"
  }
}
```

- [ ] **Step 2: Create `engine/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": false,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "esModuleInterop": true,
    "skipDefaultLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "../convex/_generated/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create stub server entry point**

`engine/src/server.ts`:
```ts
import { Hono } from "hono";

const app = new Hono();
app.get("/healthz", (c) => c.json({ ok: true }));

const port = Number(process.env.PORT ?? 8787);
export default { port, fetch: app.fetch };
```

- [ ] **Step 4: Extend root typecheck**

In root `package.json`, modify the `typecheck` script:
```json
"typecheck": "bun run typecheck:app && bun run typecheck:convex && bun run typecheck:engine",
"typecheck:engine": "bun --cwd engine tsc --noEmit",
```

- [ ] **Step 5: Install and verify**

```bash
bun install
bun --cwd engine tsc --noEmit
bun --cwd engine start &
sleep 1
curl -s http://localhost:8787/healthz
kill %1
```

Expected: `{"ok":true}` from curl.

- [ ] **Step 6: Commit**

```bash
git add engine/ package.json bun.lock
git commit -m "feat(engine): bootstrap Bun + Hono package with healthz stub"
```

---

## Task 11: Engine env validation

**Files:**
- Create: `engine/src/env.ts`
- Create: `engine/src/env.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { loadEnv } from "./env";

describe("loadEnv", () => {
  test("parses a valid env", () => {
    const env = loadEnv({
      AGENTIC_SERVER_TOKEN: "tok",
      CONVEX_URL: "https://x.convex.cloud",
      PORT: "8787",
      LOG_DIR: "/tmp/agentic-logs",
    });
    expect(env.token).toBe("tok");
    expect(env.convexUrl).toBe("https://x.convex.cloud");
    expect(env.port).toBe(8787);
    expect(env.logDir).toBe("/tmp/agentic-logs");
  });

  test("rejects missing token", () => {
    expect(() =>
      loadEnv({ CONVEX_URL: "https://x.convex.cloud" } as any),
    ).toThrow(/AGENTIC_SERVER_TOKEN/);
  });

  test("rejects non-numeric port", () => {
    expect(() =>
      loadEnv({
        AGENTIC_SERVER_TOKEN: "tok",
        CONVEX_URL: "https://x.convex.cloud",
        PORT: "not-a-port",
      } as any),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

- [ ] **Step 3: Implement**

`engine/src/env.ts`:
```ts
import { z } from "zod";

const schema = z.object({
  AGENTIC_SERVER_TOKEN: z.string().min(8),
  CONVEX_URL: z.string().url(),
  PORT: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 8787))
    .pipe(z.number().int().min(1).max(65535)),
  LOG_DIR: z.string().optional().default("~/.agentic-engine/logs"),
});

export type Env = {
  token: string;
  convexUrl: string;
  port: number;
  logDir: string;
};

export function loadEnv(raw: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): Env {
  const parsed = schema.parse(raw);
  return {
    token: parsed.AGENTIC_SERVER_TOKEN,
    convexUrl: parsed.CONVEX_URL,
    port: parsed.PORT,
    logDir: parsed.LOG_DIR,
  };
}
```

- [ ] **Step 4: Verify and commit**

```bash
bun test engine/src/env.test.ts
bun --cwd engine tsc --noEmit
git add engine/src/env.ts engine/src/env.test.ts
git commit -m "feat(engine): zod-validated env loader"
```

---

## Task 12: Bearer auth middleware

**Files:**
- Create: `engine/src/auth.ts`
- Create: `engine/src/auth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import { bearerAuth } from "./auth";

const TOKEN = "secret-token-123";

function buildApp() {
  const app = new Hono();
  app.use("*", bearerAuth(TOKEN));
  app.get("/x", (c) => c.text("ok"));
  return app;
}

describe("bearerAuth", () => {
  test("401 on missing header", async () => {
    const res = await buildApp().request("/x");
    expect(res.status).toBe(401);
  });

  test("401 on wrong scheme", async () => {
    const res = await buildApp().request("/x", {
      headers: { Authorization: `Basic ${TOKEN}` },
    });
    expect(res.status).toBe(401);
  });

  test("401 on wrong token", async () => {
    const res = await buildApp().request("/x", {
      headers: { Authorization: "Bearer nope" },
    });
    expect(res.status).toBe(401);
  });

  test("200 on correct bearer", async () => {
    const res = await buildApp().request("/x", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
});
```

- [ ] **Step 2: Run test, expect failure**

- [ ] **Step 3: Implement**

`engine/src/auth.ts`:
```ts
import type { MiddlewareHandler } from "hono";

export function bearerAuth(expected: string): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? c.req.header("Authorization");
    if (!header) return c.json({ error: "missing authorization" }, 401);
    const [scheme, token] = header.split(" ", 2);
    if (scheme !== "Bearer" || !token) {
      return c.json({ error: "expected Bearer scheme" }, 401);
    }
    if (token !== expected) return c.json({ error: "invalid token" }, 401);
    await next();
  };
}
```

- [ ] **Step 4: Verify and commit**

```bash
bun test engine/src/auth.test.ts
bun --cwd engine tsc --noEmit
git add engine/src/auth.ts engine/src/auth.test.ts
git commit -m "feat(engine): bearer auth middleware"
```

---

## Task 13: Structured logger

**Files:**
- Create: `engine/src/logging/logger.ts`
- Create: `engine/src/logging/logger.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test, vi } from "vitest";
import { createLogger } from "./logger";

describe("logger", () => {
  test("emits structured JSON to the provided sink", () => {
    const sink = vi.fn();
    const log = createLogger({ sink });
    log.info("hello", { entity_ref: "x" });
    expect(sink).toHaveBeenCalledTimes(1);
    const line = sink.mock.calls[0][0];
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("hello");
    expect(parsed.entity_ref).toBe("x");
    expect(parsed.ts).toBeTypeOf("number");
  });

  test("error level captures stack from Error", () => {
    const sink = vi.fn();
    const log = createLogger({ sink });
    log.error("boom", { err: new Error("kaboom") });
    const parsed = JSON.parse(sink.mock.calls[0][0]);
    expect(parsed.err.message).toBe("kaboom");
    expect(parsed.err.stack).toBeTypeOf("string");
  });
});
```

- [ ] **Step 2: Run test, expect failure**

- [ ] **Step 3: Implement**

`engine/src/logging/logger.ts`:
```ts
type Level = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug: (msg: string, fields?: Record<string, unknown>) => void;
  info: (msg: string, fields?: Record<string, unknown>) => void;
  warn: (msg: string, fields?: Record<string, unknown>) => void;
  error: (msg: string, fields?: Record<string, unknown>) => void;
}

function serializeField(v: unknown): unknown {
  if (v instanceof Error) return { message: v.message, stack: v.stack };
  return v;
}

export function createLogger(opts: { sink?: (line: string) => void } = {}): Logger {
  const sink = opts.sink ?? ((line) => process.stdout.write(line + "\n"));
  const emit = (level: Level, msg: string, fields: Record<string, unknown> = {}) => {
    const serialized: Record<string, unknown> = { ts: Date.now(), level, msg };
    for (const [k, v] of Object.entries(fields)) serialized[k] = serializeField(v);
    sink(JSON.stringify(serialized));
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
  };
}
```

- [ ] **Step 4: Verify and commit**

```bash
bun test engine/src/logging/logger.test.ts
bun --cwd engine tsc --noEmit
git add engine/src/logging
git commit -m "feat(engine): structured JSON logger"
```

---

## Task 14: NDJSON shadow event log

**Files:**
- Create: `engine/src/logging/ndjson.ts`
- Create: `engine/src/logging/ndjson.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createNdjsonAppender } from "./ndjson";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ndjson-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("ndjson appender", () => {
  test("writes events to a per-entity file", async () => {
    const appender = createNdjsonAppender({ baseDir: dir });
    await appender.append("todoist:task:abc", { event: "hello" });
    await appender.append("todoist:task:abc", { event: "world" });
    await appender.append("todoist:task:xyz", { event: "other" });
    const abc = readFileSync(join(dir, "todoist_task_abc.ndjson"), "utf8");
    expect(abc.trim().split("\n")).toHaveLength(2);
    expect(JSON.parse(abc.trim().split("\n")[0]).event).toBe("hello");
    const xyz = readFileSync(join(dir, "todoist_task_xyz.ndjson"), "utf8");
    expect(JSON.parse(xyz.trim()).event).toBe("other");
  });
});
```

- [ ] **Step 2: Run test, expect failure**

- [ ] **Step 3: Implement**

`engine/src/logging/ndjson.ts`:
```ts
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

function sanitize(entity_ref: string): string {
  return entity_ref.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export interface NdjsonAppender {
  append: (entity_ref: string, event: unknown) => Promise<void>;
}

export function createNdjsonAppender(opts: { baseDir: string }): NdjsonAppender {
  let initialized = false;
  return {
    async append(entity_ref, event) {
      if (!initialized) {
        await mkdir(opts.baseDir, { recursive: true });
        initialized = true;
      }
      const path = join(opts.baseDir, `${sanitize(entity_ref)}.ndjson`);
      await appendFile(path, JSON.stringify(event) + "\n", "utf8");
    },
  };
}
```

- [ ] **Step 4: Verify and commit**

```bash
bun test engine/src/logging/ndjson.test.ts
bun --cwd engine tsc --noEmit
git add engine/src/logging/ndjson.ts engine/src/logging/ndjson.test.ts
git commit -m "feat(engine): per-entity NDJSON shadow event log"
```

---

## Task 15: Proposal zod schema and canonical event types

**Files:**
- Create: `engine/src/runner/proposalSchema.ts`
- Create: `engine/src/runner/proposalSchema.test.ts`
- Create: `engine/src/runner/types.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { ProposalSchema } from "./proposalSchema";

describe("ProposalSchema", () => {
  test("accepts a minimal proposal", () => {
    const p = ProposalSchema.parse({
      kind: "proposal",
      summary: "hello",
      options: [],
      free_text_allowed: true,
    });
    expect(p.kind).toBe("proposal");
  });

  test("accepts a clarification with question + options", () => {
    const p = ProposalSchema.parse({
      kind: "clarification",
      summary: "I need to know",
      question: "Which project?",
      options: [
        {
          id: "a",
          label: "Inbox",
          description: "Top-level inbox",
          confidence: 0.8,
          reversibility: "trivial",
        },
      ],
      free_text_allowed: true,
    });
    expect(p.options[0].confidence).toBe(0.8);
  });

  test("rejects unknown kind", () => {
    expect(() =>
      ProposalSchema.parse({
        kind: "nope",
        summary: "x",
        options: [],
        free_text_allowed: false,
      }),
    ).toThrow();
  });

  test("rejects confidence out of range", () => {
    expect(() =>
      ProposalSchema.parse({
        kind: "proposal",
        summary: "x",
        options: [
          {
            id: "a",
            label: "a",
            description: "a",
            confidence: 1.5,
            reversibility: "trivial",
          },
        ],
        free_text_allowed: false,
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

- [ ] **Step 3: Implement schema**

`engine/src/runner/proposalSchema.ts`:
```ts
import { z } from "zod";

export const ProposalOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  rationale: z.string().optional(),
  confidence: z.number().min(0).max(1),
  reversibility: z.enum(["trivial", "moderate", "destructive"]),
  side_effects: z.array(z.string()).optional(),
});

export const ProposalSchema = z.object({
  kind: z.enum(["clarification", "proposal", "execution_result", "blocked"]),
  summary: z.string(),
  findings: z.array(z.string()).optional(),
  options: z.array(ProposalOptionSchema),
  recommended_option_id: z.string().optional(),
  free_text_allowed: z.boolean(),
  question: z.string().optional(),
});

export type Proposal = z.infer<typeof ProposalSchema>;
export type ProposalOption = z.infer<typeof ProposalOptionSchema>;
```

- [ ] **Step 4: Implement event types**

`engine/src/runner/types.ts`:
```ts
import type { Proposal } from "./proposalSchema";

export type CanonicalEvent =
  | { type: "user_message"; body_markdown: string }
  | { type: "assistant_message"; body_markdown: string; token_usage?: TokenUsage }
  | { type: "reasoning"; body_markdown: string }
  | { type: "tool_call_started"; activity_key: string; name: string; input: unknown }
  | { type: "tool_call_resolved"; activity_key: string; status: "ok" | "error"; output: unknown }
  | { type: "proposal"; proposal: Proposal; checkpoint_id: string }
  | { type: "execution_result"; body_markdown: string; checkpoint_id: string }
  | { type: "blocked"; body_markdown: string; checkpoint_id: string }
  | { type: "error"; error: { message: string; details?: unknown } };

export type CanonicalTerminalEvent = Extract<
  CanonicalEvent,
  { type: "proposal" | "execution_result" | "blocked" | "error" }
>;

export interface TokenUsage {
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
}

export interface AgentRunInput {
  entity_ref: string;
  resume_cursor: unknown | null;
  entity_payload: unknown;
  message: string | null;
  on_event: (e: CanonicalEvent) => Promise<void>;
}

export interface AgentRunResult {
  resume_cursor: unknown;
  terminal: CanonicalTerminalEvent;
}

export interface AgentRunner {
  run(input: AgentRunInput): Promise<AgentRunResult>;
  interrupt(entity_ref: string): Promise<void>;
}
```

- [ ] **Step 5: Verify and commit**

```bash
bun test engine/src/runner/proposalSchema.test.ts
bun --cwd engine tsc --noEmit
git add engine/src/runner/proposalSchema.ts engine/src/runner/proposalSchema.test.ts engine/src/runner/types.ts
git commit -m "feat(engine): canonical event types + Proposal zod schema"
```

---

## Task 16: EchoRunner — deterministic fake AgentRunner

**Files:**
- Create: `engine/src/runner/echoRunner.ts`
- Create: `engine/src/runner/echoRunner.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { createEchoRunner } from "./echoRunner";
import type { CanonicalEvent } from "./types";

describe("EchoRunner", () => {
  test("emits a fixed event sequence and terminates with proposal", async () => {
    const events: CanonicalEvent[] = [];
    const runner = createEchoRunner();
    const result = await runner.run({
      entity_ref: "todoist:task:abc",
      resume_cursor: null,
      entity_payload: { content: "do thing" },
      message: null,
      on_event: async (e) => {
        events.push(e);
      },
    });
    expect(events[0]).toMatchObject({ type: "assistant_message" });
    expect(events[events.length - 1]).toMatchObject({ type: "proposal" });
    expect(result.terminal.type).toBe("proposal");
    expect(typeof result.resume_cursor).toBe("object");
  });

  test("with EXECUTE message terminates as execution_result", async () => {
    const runner = createEchoRunner();
    const result = await runner.run({
      entity_ref: "todoist:task:abc",
      resume_cursor: { turn: 1 },
      entity_payload: { content: "do thing" },
      message: "EXECUTE: opt-a",
      on_event: async () => {},
    });
    expect(result.terminal.type).toBe("execution_result");
  });

  test("interrupt resolves without error", async () => {
    const runner = createEchoRunner();
    await expect(runner.interrupt("todoist:task:abc")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

- [ ] **Step 3: Implement**

`engine/src/runner/echoRunner.ts`:
```ts
import { randomUUID } from "node:crypto";
import type {
  AgentRunInput,
  AgentRunResult,
  AgentRunner,
  CanonicalEvent,
} from "./types";

export function createEchoRunner(): AgentRunner {
  return {
    async run(input: AgentRunInput): Promise<AgentRunResult> {
      const events: CanonicalEvent[] = [
        {
          type: "assistant_message",
          body_markdown: `received: ${input.message ?? "<initial>"}`,
        },
      ];
      const checkpoint_id = randomUUID();
      let terminal: CanonicalEvent;
      if (input.message?.startsWith("EXECUTE:")) {
        terminal = {
          type: "execution_result",
          body_markdown: `executed ${input.message.slice("EXECUTE:".length).trim()}`,
          checkpoint_id,
        };
      } else {
        terminal = {
          type: "proposal",
          checkpoint_id,
          proposal: {
            kind: "proposal",
            summary: "echo proposal",
            options: [
              {
                id: "opt-a",
                label: "Do A",
                description: "the only option",
                confidence: 0.9,
                reversibility: "trivial",
              },
            ],
            recommended_option_id: "opt-a",
            free_text_allowed: true,
          },
        };
      }
      events.push(terminal);
      for (const e of events) await input.on_event(e);
      return {
        resume_cursor: { turn: ((input.resume_cursor as any)?.turn ?? 0) + 1 },
        terminal: terminal as AgentRunResult["terminal"],
      };
    },
    async interrupt() {
      /* no-op */
    },
  };
}
```

- [ ] **Step 4: Verify and commit**

```bash
bun test engine/src/runner/echoRunner.test.ts
bun --cwd engine tsc --noEmit
git add engine/src/runner/echoRunner.ts engine/src/runner/echoRunner.test.ts
git commit -m "feat(engine): EchoRunner test double"
```

---

## Task 17: EntitySource interface + entity_ref parser

**Files:**
- Create: `engine/src/sources/types.ts`
- Create: `engine/src/sources/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { parseEntityRef } from "./types";

describe("parseEntityRef", () => {
  test("parses todoist:task:abc", () => {
    expect(parseEntityRef("todoist:task:7218390471")).toEqual({
      entity_type: "todoist_task",
      entity_id: "7218390471",
      raw: "todoist:task:7218390471",
    });
  });

  test("parses gmail:thread:foo", () => {
    expect(parseEntityRef("gmail:thread:abc-def")).toEqual({
      entity_type: "gmail_thread",
      entity_id: "abc-def",
      raw: "gmail:thread:abc-def",
    });
  });

  test("rejects malformed refs", () => {
    expect(() => parseEntityRef("nope")).toThrow();
    expect(() => parseEntityRef("a:b")).toThrow();
    expect(() => parseEntityRef("")).toThrow();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

- [ ] **Step 3: Implement**

`engine/src/sources/types.ts`:
```ts
export interface ParsedEntityRef {
  entity_type: string;
  entity_id: string;
  raw: string;
}

export function parseEntityRef(raw: string): ParsedEntityRef {
  const parts = raw.split(":");
  if (parts.length < 3 || parts.some((p) => p.length === 0)) {
    throw new Error(`malformed entity_ref: ${raw}`);
  }
  const [system, kind, ...idParts] = parts;
  return {
    entity_type: `${system}_${kind}`,
    entity_id: idParts.join(":"),
    raw,
  };
}

export interface EntitySource<TPayload = unknown> {
  fetch(entity_ref: string): Promise<TPayload>;
}
```

- [ ] **Step 4: Verify and commit**

```bash
bun test engine/src/sources/types.test.ts
bun --cwd engine tsc --noEmit
git add engine/src/sources/types.ts engine/src/sources/types.test.ts
git commit -m "feat(engine): entity_ref parser and EntitySource interface"
```

---

## Task 18: TodoistTaskSource and source registry

**Files:**
- Create: `engine/src/sources/todoistTask.ts`
- Create: `engine/src/sources/registry.ts`
- Create: `engine/src/sources/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test, vi } from "vitest";
import { createSourceRegistry } from "./registry";
import type { EntitySource } from "./types";

describe("sourceRegistry", () => {
  test("dispatches by entity_type", async () => {
    const todoist: EntitySource = {
      fetch: vi.fn().mockResolvedValue({ content: "task" }),
    };
    const gmail: EntitySource = {
      fetch: vi.fn().mockResolvedValue({ subject: "hi" }),
    };
    const reg = createSourceRegistry({
      todoist_task: todoist,
      gmail_thread: gmail,
    });
    const r1 = await reg.fetch("todoist:task:abc");
    expect(r1).toEqual({ content: "task" });
    expect(todoist.fetch).toHaveBeenCalledWith("todoist:task:abc");
    const r2 = await reg.fetch("gmail:thread:xyz");
    expect(r2).toEqual({ subject: "hi" });
  });

  test("throws on unknown entity_type", async () => {
    const reg = createSourceRegistry({});
    await expect(reg.fetch("unknown:thing:1")).rejects.toThrow(/no source/i);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

- [ ] **Step 3: Implement source registry**

`engine/src/sources/registry.ts`:
```ts
import { parseEntityRef, type EntitySource } from "./types";

export interface SourceRegistry {
  fetch(entity_ref: string): Promise<unknown>;
}

export function createSourceRegistry(
  sources: Record<string, EntitySource>,
): SourceRegistry {
  return {
    async fetch(entity_ref: string) {
      const { entity_type } = parseEntityRef(entity_ref);
      const source = sources[entity_type];
      if (!source) {
        throw new Error(`no source registered for entity_type=${entity_type}`);
      }
      return source.fetch(entity_ref);
    },
  };
}
```

- [ ] **Step 4: Implement TodoistTaskSource**

`engine/src/sources/todoistTask.ts`:
```ts
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import { parseEntityRef, type EntitySource } from "./types";

export interface TodoistTaskPayload {
  id: string;
  content: string;
  description?: string;
  project_id?: string;
  due?: unknown;
  raw: unknown;
}

export function createTodoistTaskSource(
  client: ConvexHttpClient,
): EntitySource<TodoistTaskPayload> {
  return {
    async fetch(entity_ref: string) {
      const { entity_id } = parseEntityRef(entity_ref);
      const row = await client.query(api.todoist.queries.getItemById, {
        id: entity_id,
      });
      if (!row) throw new Error(`todoist task not found: ${entity_id}`);
      return {
        id: entity_id,
        content: row.content,
        description: row.description ?? undefined,
        project_id: row.project_id ?? undefined,
        due: row.due,
        raw: row,
      };
    },
  };
}
```

NOTE: The exact `api.todoist.queries.getItemById` reference depends on master-db's actual exports. If that path doesn't exist, search master-db's existing Todoist queries and pick whichever returns a task by id; if none exists, that's a missing dependency and the executor should add a `getItemById` query to `convex/todoist/queries` before continuing this task. Confirm by running:

```bash
ls convex/todoist/queries
grep -rn "getItemById\|by_id\|getById" convex/todoist
```

- [ ] **Step 5: Verify and commit**

```bash
bun test engine/src/sources/registry.test.ts
bun --cwd engine tsc --noEmit
git add engine/src/sources
git commit -m "feat(engine): source registry + TodoistTaskSource"
```

---

## Task 19: Convex store wrapper

**Files:**
- Create: `engine/src/store/convex.ts`
- Create: `engine/src/store/convex.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test, vi } from "vitest";
import { createConvexStore } from "./convex";

function fakeClient() {
  const calls: { op: string; name: string; args: unknown }[] = [];
  return {
    calls,
    query: vi.fn(async (name: any, args: unknown) => {
      calls.push({ op: "query", name: String(name), args });
      return null;
    }),
    mutation: vi.fn(async (name: any, args: unknown) => {
      calls.push({ op: "mutation", name: String(name), args });
      return "ID";
    }),
  } as any;
}

describe("ConvexStore", () => {
  test("getRun calls api.agentic.queries.getRun", async () => {
    const client = fakeClient();
    const store = createConvexStore(client);
    await store.getRun("todoist:task:abc");
    expect(client.calls[0].op).toBe("query");
    expect(client.calls[0].args).toEqual({ entity_ref: "todoist:task:abc" });
  });

  test("upsertRun forwards args verbatim", async () => {
    const client = fakeClient();
    const store = createConvexStore(client);
    await store.upsertRun({
      entity_ref: "todoist:task:abc",
      entity_type: "todoist_task",
      entity_id: "abc",
      backend: "claude_sdk",
      status: "discovering",
      run_id: "01H1",
      traceparent: null,
      resume_cursor: null,
    });
    expect(client.calls[0].op).toBe("mutation");
    expect((client.calls[0].args as any).run_id).toBe("01H1");
  });

  test("appendThreadMessage returns id", async () => {
    const client = fakeClient();
    const store = createConvexStore(client);
    const id = await store.appendThreadMessage({
      entity_ref: "todoist:task:abc",
      run_id: "01H1",
      kind: "user_message",
      body_markdown: "hi",
      proposal_json: null,
      error_json: null,
      token_usage: null,
      checkpoint_id: null,
    });
    expect(id).toBe("ID");
  });
});
```

- [ ] **Step 2: Run test, expect failure**

- [ ] **Step 3: Implement**

`engine/src/store/convex.ts`:
```ts
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";

export interface UpsertRunArgs {
  entity_ref: string;
  entity_type: string;
  entity_id: string;
  backend: string;
  status: string;
  run_id: string;
  traceparent: string | null;
  resume_cursor: object | null;
}

export interface AppendMessageArgs {
  entity_ref: string;
  run_id: string;
  kind: string;
  body_markdown: string | null;
  proposal_json: unknown | null;
  error_json: unknown | null;
  token_usage: unknown | null;
  checkpoint_id: string | null;
}

export interface StartActivityArgs {
  entity_ref: string;
  run_id: string;
  kind: string;
  name: string;
  input_json: unknown;
}

export interface ResolveActivityArgs {
  id: string;
  status: "ok" | "error";
  output_json: unknown | null;
}

export interface UpdateRunStatusArgs {
  entity_ref: string;
  status: string;
  last_message_id: string | null;
  resume_cursor: object | null;
}

export interface ConvexStore {
  getRun(entity_ref: string): Promise<unknown>;
  getThread(entity_ref: string): Promise<unknown[]>;
  upsertRun(args: UpsertRunArgs): Promise<string>;
  appendThreadMessage(args: AppendMessageArgs): Promise<string>;
  startActivity(args: StartActivityArgs): Promise<string>;
  resolveActivity(args: ResolveActivityArgs): Promise<void>;
  updateRunStatus(args: UpdateRunStatusArgs): Promise<void>;
}

export function createConvexStore(client: ConvexHttpClient): ConvexStore {
  return {
    getRun: (entity_ref) =>
      client.query(api.agentic.queries.getRun, { entity_ref }),
    getThread: (entity_ref) =>
      client.query(api.agentic.queries.getThread, { entity_ref }) as Promise<
        unknown[]
      >,
    upsertRun: (args) =>
      client.mutation(api.agentic.mutations.upsertRun, args) as Promise<string>,
    appendThreadMessage: (args) =>
      client.mutation(
        api.agentic.mutations.appendThreadMessage,
        args,
      ) as Promise<string>,
    startActivity: (args) =>
      client.mutation(api.agentic.mutations.recordActivity.start, args) as Promise<
        string
      >,
    resolveActivity: (args) =>
      client.mutation(api.agentic.mutations.recordActivity.resolve, args) as Promise<
        void
      >,
    updateRunStatus: (args) =>
      client.mutation(api.agentic.mutations.updateRunStatus, args) as Promise<
        void
      >,
  };
}
```

- [ ] **Step 4: Verify and commit**

```bash
bun test engine/src/store/convex.test.ts
bun --cwd engine tsc --noEmit
git add engine/src/store
git commit -m "feat(engine): typed Convex store wrapper"
```

---

## Task 20: Idempotency cache

**Files:**
- Create: `engine/src/concurrency/idempotencyCache.ts`
- Create: `engine/src/concurrency/idempotencyCache.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test, vi } from "vitest";
import { createIdempotencyCache } from "./idempotencyCache";

describe("idempotencyCache", () => {
  test("returns cached value within TTL", async () => {
    vi.useFakeTimers();
    const cache = createIdempotencyCache({ ttlMs: 1000 });
    const fn = vi.fn().mockResolvedValue({ value: 1 });
    const r1 = await cache.runOnce({ key: "k", entity_ref: "e", route: "r" }, fn);
    const r2 = await cache.runOnce({ key: "k", entity_ref: "e", route: "r" }, fn);
    expect(r1).toEqual({ value: 1 });
    expect(r2).toEqual({ value: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  test("re-runs after TTL expires", async () => {
    vi.useFakeTimers();
    const cache = createIdempotencyCache({ ttlMs: 100 });
    const fn = vi.fn().mockImplementation(async () => ({ n: Math.random() }));
    await cache.runOnce({ key: "k", entity_ref: "e", route: "r" }, fn);
    vi.advanceTimersByTime(200);
    await cache.runOnce({ key: "k", entity_ref: "e", route: "r" }, fn);
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  test("skips cache when key is undefined", async () => {
    const cache = createIdempotencyCache({ ttlMs: 1000 });
    const fn = vi.fn().mockResolvedValue("x");
    await cache.runOnce({ key: undefined, entity_ref: "e", route: "r" }, fn);
    await cache.runOnce({ key: undefined, entity_ref: "e", route: "r" }, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

- [ ] **Step 3: Implement**

`engine/src/concurrency/idempotencyCache.ts`:
```ts
import { LRUCache } from "lru-cache";

interface Key {
  key: string | undefined;
  entity_ref: string;
  route: string;
}

export interface IdempotencyCache {
  runOnce<T>(key: Key, fn: () => Promise<T>): Promise<T>;
}

export function createIdempotencyCache(opts: {
  ttlMs: number;
  max?: number;
}): IdempotencyCache {
  const lru = new LRUCache<string, unknown>({
    max: opts.max ?? 5000,
    ttl: opts.ttlMs,
  });
  return {
    async runOnce<T>(k: Key, fn: () => Promise<T>): Promise<T> {
      if (!k.key) return fn();
      const cacheKey = `${k.route}|${k.entity_ref}|${k.key}`;
      const cached = lru.get(cacheKey) as T | undefined;
      if (cached !== undefined) return cached;
      const result = await fn();
      lru.set(cacheKey, result);
      return result;
    },
  };
}
```

- [ ] **Step 4: Verify and commit**

```bash
bun test engine/src/concurrency/idempotencyCache.test.ts
bun --cwd engine tsc --noEmit
git add engine/src/concurrency/idempotencyCache.ts engine/src/concurrency/idempotencyCache.test.ts
git commit -m "feat(engine): LRU idempotency cache with TTL"
```

---

## Task 21: Per-entity queue with multitask strategies

**Files:**
- Create: `engine/src/concurrency/perEntityQueue.ts`
- Create: `engine/src/concurrency/perEntityQueue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test, vi } from "vitest";
import { createPerEntityQueue } from "./perEntityQueue";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("perEntityQueue", () => {
  test("serializes work for the same entity", async () => {
    const order: number[] = [];
    const q = createPerEntityQueue({ onInterrupt: async () => {} });
    const work = (n: number) => async () => {
      await tick();
      order.push(n);
    };
    q.enqueue("e1", work(1));
    q.enqueue("e1", work(2));
    q.enqueue("e1", work(3));
    await q.drainAll();
    expect(order).toEqual([1, 2, 3]);
  });

  test("different entities run independently", async () => {
    const q = createPerEntityQueue({ onInterrupt: async () => {} });
    let a = false;
    let b = false;
    const pa = q.enqueue("a", async () => {
      a = true;
    });
    const pb = q.enqueue("b", async () => {
      b = true;
    });
    await Promise.all([pa, pb]);
    expect(a).toBe(true);
    expect(b).toBe(true);
  });

  test("interrupt drops queued items and calls onInterrupt", async () => {
    const onInterrupt = vi.fn(async () => {});
    const q = createPerEntityQueue({ onInterrupt });
    let firstStarted = false;
    let secondCalled = false;
    q.enqueue("e1", async () => {
      firstStarted = true;
      await new Promise((r) => setTimeout(r, 50));
    });
    q.enqueue("e1", async () => {
      secondCalled = true;
    });
    await tick();
    expect(firstStarted).toBe(true);
    q.interrupt("e1");
    await new Promise((r) => setTimeout(r, 100));
    expect(secondCalled).toBe(false);
    expect(onInterrupt).toHaveBeenCalledWith("e1");
  });

  test("isBusy reflects in-flight state", async () => {
    const q = createPerEntityQueue({ onInterrupt: async () => {} });
    expect(q.isBusy("e1")).toBe(false);
    q.enqueue("e1", async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    await tick();
    expect(q.isBusy("e1")).toBe(true);
    await q.drainAll();
    expect(q.isBusy("e1")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

- [ ] **Step 3: Implement**

`engine/src/concurrency/perEntityQueue.ts`:
```ts
type Task = () => Promise<unknown>;

interface EntityState {
  queue: Task[];
  draining: boolean;
}

export interface PerEntityQueue {
  enqueue(entity_ref: string, task: Task): Promise<unknown>;
  interrupt(entity_ref: string): void;
  isBusy(entity_ref: string): boolean;
  drainAll(): Promise<void>;
}

export function createPerEntityQueue(opts: {
  onInterrupt: (entity_ref: string) => Promise<void>;
}): PerEntityQueue {
  const map = new Map<string, EntityState>();

  function getOrCreate(entity_ref: string): EntityState {
    let s = map.get(entity_ref);
    if (!s) {
      s = { queue: [], draining: false };
      map.set(entity_ref, s);
    }
    return s;
  }

  async function drain(entity_ref: string) {
    const state = map.get(entity_ref);
    if (!state || state.draining) return;
    state.draining = true;
    try {
      while (state.queue.length > 0) {
        const task = state.queue.shift()!;
        await task();
      }
    } finally {
      state.draining = false;
    }
  }

  return {
    enqueue(entity_ref, task) {
      const state = getOrCreate(entity_ref);
      let resolve: (v: unknown) => void;
      let reject: (e: unknown) => void;
      const settled = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      state.queue.push(async () => {
        try {
          resolve(await task());
        } catch (e) {
          reject(e);
        }
      });
      void drain(entity_ref);
      return settled;
    },
    interrupt(entity_ref) {
      const state = map.get(entity_ref);
      if (!state) return;
      state.queue.length = 0;
      void opts.onInterrupt(entity_ref);
    },
    isBusy(entity_ref) {
      const state = map.get(entity_ref);
      if (!state) return false;
      return state.draining || state.queue.length > 0;
    },
    async drainAll() {
      while ([...map.values()].some((s) => s.queue.length > 0 || s.draining)) {
        await new Promise((r) => setTimeout(r, 5));
      }
    },
  };
}
```

- [ ] **Step 4: Verify and commit**

```bash
bun test engine/src/concurrency/perEntityQueue.test.ts
bun --cwd engine tsc --noEmit
git add engine/src/concurrency/perEntityQueue.ts engine/src/concurrency/perEntityQueue.test.ts
git commit -m "feat(engine): per-entity work queue with interrupt"
```

---

## Task 22: Webhook delivery

**Files:**
- Create: `engine/src/webhook/deliver.ts`
- Create: `engine/src/webhook/deliver.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test, vi } from "vitest";
import { deliverWebhook } from "./deliver";

describe("deliverWebhook", () => {
  test("posts JSON with optional bearer token", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    await deliverWebhook(
      { url: "https://example.com/wh", token: "tok", body: { a: 1 } },
      { fetch: fetchFn, retries: 0, backoffMs: 0 },
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://example.com/wh");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok",
    );
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });

  test("retries on 500 then succeeds", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(new Response("", { status: 200 }));
    const result = await deliverWebhook(
      { url: "https://example.com", token: null, body: {} },
      { fetch: fetchFn, retries: 3, backoffMs: 0 },
    );
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(result.delivered).toBe(true);
  });

  test("gives up after retries", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    const result = await deliverWebhook(
      { url: "https://example.com", token: null, body: {} },
      { fetch: fetchFn, retries: 2, backoffMs: 0 },
    );
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(result.delivered).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

- [ ] **Step 3: Implement**

`engine/src/webhook/deliver.ts`:
```ts
export interface WebhookPayload {
  url: string;
  token: string | null;
  body: unknown;
}

export interface DeliveryOpts {
  fetch?: typeof fetch;
  retries?: number;
  backoffMs?: number;
}

export interface DeliveryResult {
  delivered: boolean;
  attempts: number;
  finalStatus: number | null;
}

export async function deliverWebhook(
  payload: WebhookPayload,
  opts: DeliveryOpts = {},
): Promise<DeliveryResult> {
  const fetchFn = opts.fetch ?? fetch;
  const retries = opts.retries ?? 3;
  const backoff = opts.backoffMs ?? 1000;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (payload.token) headers.Authorization = `Bearer ${payload.token}`;
  let attempts = 0;
  let finalStatus: number | null = null;
  for (let i = 0; i <= retries; i++) {
    attempts++;
    try {
      const res = await fetchFn(payload.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload.body),
      });
      finalStatus = res.status;
      if (res.ok) return { delivered: true, attempts, finalStatus };
    } catch {
      finalStatus = null;
    }
    if (i < retries) await new Promise((r) => setTimeout(r, backoff * 2 ** i));
  }
  return { delivered: false, attempts, finalStatus };
}
```

- [ ] **Step 4: Verify and commit**

```bash
bun test engine/src/webhook/deliver.test.ts
bun --cwd engine tsc --noEmit
git add engine/src/webhook
git commit -m "feat(engine): webhook delivery with retry/backoff"
```

---

## Task 23: Run handler — POST /run

**Files:**
- Create: `engine/src/routes/run.ts`
- Create: `engine/src/routes/run.test.ts`

This task wires queue + store + runner. The handler is heavyweight; the test uses `EchoRunner` and an in-memory fake store.

- [ ] **Step 1: Write the failing test**

```ts
import { Hono } from "hono";
import { describe, expect, test, vi } from "vitest";
import { createRunRoutes } from "./run";
import { createEchoRunner } from "../runner/echoRunner";
import { createPerEntityQueue } from "../concurrency/perEntityQueue";
import { createIdempotencyCache } from "../concurrency/idempotencyCache";
import type { ConvexStore } from "../store/convex";

function fakeStore(): ConvexStore & { state: { run: any; messages: any[]; activities: any[] } } {
  const state = { run: null as any, messages: [] as any[], activities: [] as any[] };
  return {
    state,
    async getRun() {
      return state.run;
    },
    async getThread() {
      return [];
    },
    async upsertRun(args) {
      state.run = { ...args, _id: "RUN1" };
      return "RUN1";
    },
    async appendThreadMessage(args) {
      const id = `MSG${state.messages.length + 1}`;
      state.messages.push({ ...args, _id: id });
      return id;
    },
    async startActivity(args) {
      const id = `ACT${state.activities.length + 1}`;
      state.activities.push({ ...args, _id: id, status: "pending" });
      return id;
    },
    async resolveActivity({ id, status, output_json }) {
      const a = state.activities.find((x) => x._id === id);
      if (a) Object.assign(a, { status, output_json });
    },
    async updateRunStatus(args) {
      state.run = { ...state.run, ...args };
    },
  };
}

const fakeSource = {
  fetch: async () => ({ id: "abc", content: "do thing", raw: { content: "do thing" } }),
};

function buildApp() {
  const store = fakeStore();
  const queue = createPerEntityQueue({ onInterrupt: async () => {} });
  const cache = createIdempotencyCache({ ttlMs: 10000 });
  const runner = createEchoRunner();
  const app = new Hono();
  app.route(
    "/",
    createRunRoutes({
      store,
      queue,
      cache,
      runner,
      sources: { fetch: async (ref) => fakeSource.fetch() },
      ndjson: { append: async () => {} },
      webhookDeliver: vi.fn(async () => ({ delivered: true, attempts: 1, finalStatus: 200 })),
    }),
  );
  return { app, store, queue };
}

describe("POST /run", () => {
  test("kicks off a discovery and writes a proposal", async () => {
    const { app, store, queue } = buildApp();
    const res = await app.request("/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entity_ref: "todoist:task:abc" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.entity_ref).toBe("todoist:task:abc");
    expect(body.accepted).toBe(true);
    expect(body.run_id).toMatch(/[0-9A-Z]{10,}/);
    await queue.drainAll();
    const proposal = store.state.messages.find((m) => m.kind === "proposal");
    expect(proposal).toBeTruthy();
    expect(proposal.run_id).toBe(body.run_id);
    expect(proposal.checkpoint_id).toBeTruthy();
    expect(store.state.run.status).toBe("awaiting_decision");
  });

  test("null message against existing run returns accepted:false", async () => {
    const { app, store, queue } = buildApp();
    await app.request("/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entity_ref: "todoist:task:abc" }),
    });
    await queue.drainAll();
    const res = await app.request("/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entity_ref: "todoist:task:abc" }),
    });
    const body = (await res.json()) as any;
    expect(body.accepted).toBe(false);
  });

  test("multitask_strategy=reject while busy returns 409", async () => {
    const { app, store, queue } = buildApp();
    // First call enqueues; before it drains, second call comes in.
    const p1 = app.request("/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entity_ref: "todoist:task:abc" }),
    });
    const res2 = await app.request("/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entity_ref: "todoist:task:abc",
        message: "hello",
        multitask_strategy: "reject",
      }),
    });
    expect(res2.status).toBe(409);
    await p1;
    await queue.drainAll();
  });

  test("idempotency-key returns cached response", async () => {
    const { app } = buildApp();
    const r1 = await app.request("/run", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "kx" },
      body: JSON.stringify({ entity_ref: "todoist:task:abc" }),
    });
    const r2 = await app.request("/run", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "kx" },
      body: JSON.stringify({ entity_ref: "todoist:task:abc" }),
    });
    expect(await r1.text()).toBe(await r2.text());
  });
});
```

- [ ] **Step 2: Run test, expect failure**

- [ ] **Step 3: Implement**

`engine/src/routes/run.ts`:
```ts
import { Hono } from "hono";
import { z } from "zod";
import { ulid } from "ulid";
import type { AgentRunner, CanonicalEvent } from "../runner/types";
import type { ConvexStore } from "../store/convex";
import type { PerEntityQueue } from "../concurrency/perEntityQueue";
import type { IdempotencyCache } from "../concurrency/idempotencyCache";
import type { SourceRegistry } from "../sources/registry";
import type { NdjsonAppender } from "../logging/ndjson";
import { parseEntityRef } from "../sources/types";
import type { deliverWebhook as DeliverWebhookFn, WebhookPayload, DeliveryOpts } from "../webhook/deliver";

const RunBody = z.object({
  entity_ref: z.string().min(1),
  message: z.string().nullable().optional(),
  multitask_strategy: z
    .enum(["enqueue", "interrupt", "reject"])
    .optional()
    .default("enqueue"),
  webhook: z.string().url().nullable().optional(),
  webhook_token: z.string().nullable().optional(),
});

export interface RunRoutesDeps {
  store: ConvexStore;
  queue: PerEntityQueue;
  cache: IdempotencyCache;
  runner: AgentRunner;
  sources: SourceRegistry;
  ndjson: NdjsonAppender;
  webhookDeliver: (payload: WebhookPayload, opts?: DeliveryOpts) => Promise<{ delivered: boolean; attempts: number; finalStatus: number | null }>;
}

export function createRunRoutes(deps: RunRoutesDeps) {
  const app = new Hono();

  app.post("/run", async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = RunBody.safeParse(raw);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const body = parsed.data;
    const idem = c.req.header("Idempotency-Key") || c.req.header("idempotency-key");
    const traceparent = c.req.header("traceparent") || c.req.header("Traceparent") || null;

    return deps.cache.runOnce(
      { key: idem, entity_ref: body.entity_ref, route: "POST /run" },
      async () => {
        const existingRun = await deps.store.getRun(body.entity_ref);
        const busy = deps.queue.isBusy(body.entity_ref);

        if (!body.message && existingRun) {
          return c.json({
            entity_ref: body.entity_ref,
            run_id: (existingRun as any).last_run_id ?? null,
            status: (existingRun as any).status ?? "idle",
            accepted: false,
          });
        }

        if (body.multitask_strategy === "reject" && busy) {
          return c.json(
            {
              entity_ref: body.entity_ref,
              run_id: (existingRun as any)?.last_run_id ?? null,
              status: (existingRun as any)?.status ?? "discovering",
              accepted: false,
              reason: "busy",
            },
            409,
          );
        }

        if (body.multitask_strategy === "interrupt" && busy) {
          deps.queue.interrupt(body.entity_ref);
        }

        const run_id = ulid();
        deps.queue.enqueue(body.entity_ref, () =>
          executeRun({
            deps,
            entity_ref: body.entity_ref,
            run_id,
            message: body.message ?? null,
            traceparent,
            webhook: body.webhook ?? null,
            webhook_token: body.webhook_token ?? null,
            existingRun,
          }),
        );

        return c.json({
          entity_ref: body.entity_ref,
          run_id,
          status: "discovering",
          accepted: true,
        });
      },
    );
  });

  return app;
}

interface ExecuteRunArgs {
  deps: RunRoutesDeps;
  entity_ref: string;
  run_id: string;
  message: string | null;
  traceparent: string | null;
  webhook: string | null;
  webhook_token: string | null;
  existingRun: unknown;
}

async function executeRun({ deps, entity_ref, run_id, message, traceparent, webhook, webhook_token, existingRun }: ExecuteRunArgs) {
  const parsed = parseEntityRef(entity_ref);
  const resume_cursor =
    (existingRun as any)?.resume_cursor ?? null;
  await deps.store.upsertRun({
    entity_ref,
    entity_type: parsed.entity_type,
    entity_id: parsed.entity_id,
    backend: "claude_sdk",
    status: "discovering",
    run_id,
    traceparent,
    resume_cursor,
  });
  if (message) {
    await deps.store.appendThreadMessage({
      entity_ref,
      run_id,
      kind: "user_message",
      body_markdown: message,
      proposal_json: null,
      error_json: null,
      token_usage: null,
      checkpoint_id: null,
    });
  }
  const payload = await deps.sources.fetch(entity_ref);

  let lastMessageId: string | null = null;
  const activityIds = new Map<string, string>();

  const onEvent = async (e: CanonicalEvent) => {
    await deps.ndjson.append(entity_ref, { run_id, event: e });
    switch (e.type) {
      case "assistant_message":
      case "reasoning": {
        lastMessageId = await deps.store.appendThreadMessage({
          entity_ref,
          run_id,
          kind: e.type,
          body_markdown: e.body_markdown,
          proposal_json: null,
          error_json: null,
          token_usage: e.type === "assistant_message" ? e.token_usage ?? null : null,
          checkpoint_id: null,
        });
        break;
      }
      case "tool_call_started": {
        const id = await deps.store.startActivity({
          entity_ref,
          run_id,
          kind: "tool_call",
          name: e.name,
          input_json: e.input,
        });
        activityIds.set(e.activity_key, id);
        break;
      }
      case "tool_call_resolved": {
        const id = activityIds.get(e.activity_key);
        if (id) await deps.store.resolveActivity({ id, status: e.status, output_json: e.output });
        break;
      }
      case "proposal": {
        lastMessageId = await deps.store.appendThreadMessage({
          entity_ref,
          run_id,
          kind: "proposal",
          body_markdown: null,
          proposal_json: e.proposal,
          error_json: null,
          token_usage: null,
          checkpoint_id: e.checkpoint_id,
        });
        break;
      }
      case "execution_result":
      case "blocked": {
        lastMessageId = await deps.store.appendThreadMessage({
          entity_ref,
          run_id,
          kind: e.type,
          body_markdown: e.body_markdown,
          proposal_json: null,
          error_json: null,
          token_usage: null,
          checkpoint_id: e.checkpoint_id,
        });
        break;
      }
      case "error": {
        lastMessageId = await deps.store.appendThreadMessage({
          entity_ref,
          run_id,
          kind: "error",
          body_markdown: null,
          proposal_json: null,
          error_json: e.error,
          token_usage: null,
          checkpoint_id: null,
        });
        break;
      }
      case "user_message": {
        // Already recorded above; ignore if the runner re-emits.
        break;
      }
    }
  };

  let finalStatus: "awaiting_decision" | "error" = "awaiting_decision";
  let nextResumeCursor: unknown = resume_cursor;
  try {
    const result = await deps.runner.run({
      entity_ref,
      resume_cursor,
      entity_payload: payload,
      message,
      on_event: onEvent,
    });
    nextResumeCursor = result.resume_cursor;
    if (result.terminal.type === "error") finalStatus = "error";
  } catch (err) {
    finalStatus = "error";
    await onEvent({ type: "error", error: { message: (err as Error).message } });
  }

  await deps.store.updateRunStatus({
    entity_ref,
    status: finalStatus,
    last_message_id: lastMessageId,
    resume_cursor: (nextResumeCursor as object | null) ?? null,
  });

  if (webhook && lastMessageId) {
    await deps.webhookDeliver({
      url: webhook,
      token: webhook_token,
      body: {
        entity_ref,
        run_id,
        status: finalStatus,
        terminal_message_id: lastMessageId,
      },
    });
  }
}
```

- [ ] **Step 4: Verify and commit**

```bash
bun test engine/src/routes/run.test.ts
bun --cwd engine tsc --noEmit
git add engine/src/routes/run.ts engine/src/routes/run.test.ts
git commit -m "feat(engine): POST /run with multitask_strategy, idempotency, webhook"
```

---

## Task 24: Read-only routes — GET /run/:entity_ref and /status

**Files:**
- Create: `engine/src/routes/readRun.ts`
- Create: `engine/src/routes/readRun.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import { createReadRoutes } from "./readRun";
import type { ConvexStore } from "../store/convex";

function fakeStore(state: { run: any; messages: any[] }): ConvexStore {
  return {
    async getRun() {
      return state.run;
    },
    async getThread() {
      return state.messages;
    },
    async upsertRun() {
      return "x";
    },
    async appendThreadMessage() {
      return "x";
    },
    async startActivity() {
      return "x";
    },
    async resolveActivity() {},
    async updateRunStatus() {},
  };
}

function buildApp(state: { run: any; messages: any[] }) {
  const app = new Hono();
  app.route("/", createReadRoutes({
    store: fakeStore(state),
    isBusy: () => false,
  }));
  return app;
}

describe("read routes", () => {
  test("GET /run/:entity_ref returns last_proposal", async () => {
    const proposal = { kind: "proposal", summary: "x", options: [], free_text_allowed: true };
    const app = buildApp({
      run: { entity_ref: "a", last_run_id: "01H", status: "awaiting_decision", updated_at: 1 },
      messages: [
        { row_type: "message", kind: "proposal", proposal_json: proposal, sequence: 1 },
      ],
    });
    const res = await app.request("/run/a");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.last_proposal).toEqual(proposal);
    expect(body.status).toBe("awaiting_decision");
  });

  test("GET /run/:entity_ref/status returns minimal payload", async () => {
    const app = buildApp({
      run: { entity_ref: "a", last_run_id: "01H", status: "discovering", updated_at: 1, resume_cursor: { turn: 3 } },
      messages: [],
    });
    const res = await app.request("/run/a/status");
    const body = (await res.json()) as any;
    expect(body.status).toBe("discovering");
    expect(body.run_id).toBe("01H");
    expect(body.turn_count).toBe(3);
    expect(body.busy).toBe(false);
  });

  test("missing run yields 404", async () => {
    const app = buildApp({ run: null, messages: [] });
    const res = await app.request("/run/none");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

- [ ] **Step 3: Implement**

`engine/src/routes/readRun.ts`:
```ts
import { Hono } from "hono";
import type { ConvexStore } from "../store/convex";

export interface ReadRoutesDeps {
  store: ConvexStore;
  isBusy: (entity_ref: string) => boolean;
}

export function createReadRoutes(deps: ReadRoutesDeps) {
  const app = new Hono();

  app.get("/run/:entity_ref", async (c) => {
    const entity_ref = c.req.param("entity_ref");
    const run = await deps.store.getRun(entity_ref) as any;
    if (!run) return c.json({ error: "not found" }, 404);
    const thread = (await deps.store.getThread(entity_ref)) as any[];
    const lastProposal = [...thread]
      .reverse()
      .find((row) => row.row_type === "message" && row.kind === "proposal");
    return c.json({
      entity_ref,
      run_id: run.last_run_id,
      status: run.status,
      last_proposal: lastProposal?.proposal_json ?? null,
      updated_at: run.updated_at,
    });
  });

  app.get("/run/:entity_ref/status", async (c) => {
    const entity_ref = c.req.param("entity_ref");
    const run = await deps.store.getRun(entity_ref) as any;
    if (!run) return c.json({ error: "not found" }, 404);
    return c.json({
      entity_ref,
      run_id: run.last_run_id,
      status: run.status,
      busy: deps.isBusy(entity_ref),
      turn_count: (run.resume_cursor as any)?.turn ?? 0,
      updated_at: run.updated_at,
    });
  });

  return app;
}
```

- [ ] **Step 4: Verify and commit**

```bash
bun test engine/src/routes/readRun.test.ts
bun --cwd engine tsc --noEmit
git add engine/src/routes/readRun.ts engine/src/routes/readRun.test.ts
git commit -m "feat(engine): GET /run/:entity_ref + /status"
```

---

## Task 25: Interrupt route and POST /run/:entity_ref/wait

**Files:**
- Create: `engine/src/routes/interrupt.ts`
- Create: `engine/src/routes/interrupt.test.ts`
- Modify: `engine/src/routes/run.ts` (add the /wait variant)
- Modify: `engine/src/routes/run.test.ts` (extend with wait test)

- [ ] **Step 1: Write the interrupt failing test**

`engine/src/routes/interrupt.test.ts`:
```ts
import { Hono } from "hono";
import { describe, expect, test, vi } from "vitest";
import { createInterruptRoute } from "./interrupt";

function buildApp(opts: { isBusy: boolean; status: string }) {
  const interrupt = vi.fn();
  const app = new Hono();
  app.route("/", createInterruptRoute({
    queue: { interrupt, isBusy: () => opts.isBusy, enqueue: vi.fn(), drainAll: vi.fn() as any },
    store: {
      getRun: async () => ({ status: opts.status, last_run_id: "01H" }),
    } as any,
  }));
  return { app, interrupt };
}

describe("POST /run/:entity_ref/interrupt", () => {
  test("calls queue.interrupt and returns status", async () => {
    const { app, interrupt } = buildApp({ isBusy: true, status: "discovering" });
    const res = await app.request("/run/a/interrupt", { method: "POST" });
    expect(res.status).toBe(200);
    expect(interrupt).toHaveBeenCalledWith("a");
  });

  test("idempotent when nothing is running", async () => {
    const { app, interrupt } = buildApp({ isBusy: false, status: "awaiting_decision" });
    const res = await app.request("/run/a/interrupt", { method: "POST" });
    expect(res.status).toBe(200);
    expect(interrupt).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement interrupt route**

`engine/src/routes/interrupt.ts`:
```ts
import { Hono } from "hono";
import type { PerEntityQueue } from "../concurrency/perEntityQueue";
import type { ConvexStore } from "../store/convex";

export interface InterruptDeps {
  queue: PerEntityQueue;
  store: ConvexStore;
}

export function createInterruptRoute(deps: InterruptDeps) {
  const app = new Hono();
  app.post("/run/:entity_ref/interrupt", async (c) => {
    const entity_ref = c.req.param("entity_ref");
    deps.queue.interrupt(entity_ref);
    const run = (await deps.store.getRun(entity_ref)) as any;
    return c.json({
      entity_ref,
      run_id: run?.last_run_id ?? null,
      status: run?.status ?? "idle",
      accepted: true,
    });
  });
  return app;
}
```

- [ ] **Step 3: Refactor `/run` to extract a shared `enqueueRun` helper, then add `/wait`**

In `engine/src/routes/run.ts`, factor the body of the existing `app.post("/run", ...)` handler into a private helper that both routes call. The handler keeps the cache + response shape; the helper does the work decision and enqueue.

```ts
interface EnqueueDecision {
  status_code: number;
  body: {
    entity_ref: string;
    run_id: string | null;
    status: string;
    accepted: boolean;
    reason?: string;
  };
}

async function enqueueRun(
  deps: RunRoutesDeps,
  body: z.infer<typeof RunBody>,
  traceparent: string | null,
): Promise<EnqueueDecision> {
  const existingRun = await deps.store.getRun(body.entity_ref);
  const busy = deps.queue.isBusy(body.entity_ref);

  if (!body.message && existingRun) {
    return {
      status_code: 200,
      body: {
        entity_ref: body.entity_ref,
        run_id: (existingRun as any).last_run_id ?? null,
        status: (existingRun as any).status ?? "idle",
        accepted: false,
      },
    };
  }

  if (body.multitask_strategy === "reject" && busy) {
    return {
      status_code: 409,
      body: {
        entity_ref: body.entity_ref,
        run_id: (existingRun as any)?.last_run_id ?? null,
        status: (existingRun as any)?.status ?? "discovering",
        accepted: false,
        reason: "busy",
      },
    };
  }

  if (body.multitask_strategy === "interrupt" && busy) {
    deps.queue.interrupt(body.entity_ref);
  }

  const run_id = ulid();
  deps.queue.enqueue(body.entity_ref, () =>
    executeRun({
      deps,
      entity_ref: body.entity_ref,
      run_id,
      message: body.message ?? null,
      traceparent,
      webhook: body.webhook ?? null,
      webhook_token: body.webhook_token ?? null,
      existingRun,
    }),
  );

  return {
    status_code: 200,
    body: {
      entity_ref: body.entity_ref,
      run_id,
      status: "discovering",
      accepted: true,
    },
  };
}
```

Rewrite the `/run` handler to use the helper:

```ts
app.post("/run", async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = RunBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const body = parsed.data;
  const idem = c.req.header("Idempotency-Key") || c.req.header("idempotency-key");
  const traceparent = c.req.header("traceparent") || c.req.header("Traceparent") || null;
  const decision = await deps.cache.runOnce(
    { key: idem, entity_ref: body.entity_ref, route: "POST /run" },
    () => enqueueRun(deps, body, traceparent),
  );
  return c.json(decision.body, decision.status_code as 200 | 409);
});
```

Add the `/wait` route, sharing the helper and polling Convex:

```ts
app.post("/run/:entity_ref/wait", async (c) => {
  const entity_ref = c.req.param("entity_ref");
  const rawBody = await c.req.json().catch(() => ({}));
  const parsed = RunBody.safeParse({ ...rawBody, entity_ref });
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const idem = c.req.header("Idempotency-Key") || c.req.header("idempotency-key");
  const traceparent = c.req.header("traceparent") || c.req.header("Traceparent") || null;
  const timeoutSeconds = Number(c.req.query("timeout_seconds") ?? "90");

  const decision = await deps.cache.runOnce(
    { key: idem, entity_ref, route: "POST /run/:entity_ref/wait" },
    () => enqueueRun(deps, parsed.data, traceparent),
  );
  if (!decision.body.accepted || decision.status_code !== 200) {
    return c.json(decision.body, decision.status_code as 200 | 409);
  }
  const run_id = decision.body.run_id!;
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const run = (await deps.store.getRun(entity_ref)) as any;
    if (
      run &&
      run.last_run_id === run_id &&
      (run.status === "awaiting_decision" || run.status === "error")
    ) {
      const thread = (await deps.store.getThread(entity_ref)) as any[];
      const terminal_message = [...thread]
        .reverse()
        .find(
          (row) =>
            row.row_type === "message" &&
            row.run_id === run_id &&
            ["proposal", "execution_result", "blocked", "error"].includes(row.kind),
        );
      return c.json({ entity_ref, run_id, status: run.status, terminal_message });
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return c.json({ error: "timeout" }, 408);
});
```

- [ ] **Step 4: Run all route tests, verify they pass**

```bash
bun test engine/src/routes
bun --cwd engine tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add engine/src/routes
git commit -m "feat(engine): POST /run/:entity_ref/interrupt and /wait"
```

---

## Task 26: Health route

**Files:**
- Create: `engine/src/routes/health.ts`
- Create: `engine/src/routes/health.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import { createHealthRoute } from "./health";

describe("GET /healthz", () => {
  test("returns ok and counters", async () => {
    const app = new Hono();
    app.route("/", createHealthRoute({
      startedAt: Date.now() - 1000,
      inflightCount: () => 3,
      lastError: () => null,
      convexOk: () => true,
    }));
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.uptime_ms).toBeGreaterThanOrEqual(1000);
    expect(body.inflight).toBe(3);
    expect(body.convex_ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

- [ ] **Step 3: Implement**

`engine/src/routes/health.ts`:
```ts
import { Hono } from "hono";

export interface HealthDeps {
  startedAt: number;
  inflightCount: () => number;
  lastError: () => { ts: number; message: string } | null;
  convexOk: () => boolean;
}

export function createHealthRoute(deps: HealthDeps) {
  const app = new Hono();
  app.get("/healthz", (c) =>
    c.json({
      ok: deps.convexOk(),
      uptime_ms: Date.now() - deps.startedAt,
      inflight: deps.inflightCount(),
      last_error: deps.lastError(),
      convex_ok: deps.convexOk(),
    }),
  );
  return app;
}
```

- [ ] **Step 4: Verify and commit**

```bash
bun test engine/src/routes/health.test.ts
bun --cwd engine tsc --noEmit
git add engine/src/routes/health.ts engine/src/routes/health.test.ts
git commit -m "feat(engine): GET /healthz"
```

---

## Task 27: Server assembly

**Files:**
- Modify: `engine/src/server.ts`
- Create: `engine/test/integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

`engine/test/integration.test.ts`:
```ts
import { ConvexHttpClient } from "convex/browser";
import { describe, expect, test, vi } from "vitest";
import { buildServer } from "../src/server";
import { createEchoRunner } from "../src/runner/echoRunner";

// Hand-rolled fake ConvexHttpClient that pretends master-db is empty.
const fakeConvex = {
  query: vi.fn(async () => null),
  mutation: vi.fn(async () => "ID"),
} as unknown as ConvexHttpClient;

describe("server end-to-end with EchoRunner", () => {
  test("POST /run produces 200 with run_id and accepted:true", async () => {
    const app = buildServer({
      token: "tok",
      convexClient: fakeConvex,
      runner: createEchoRunner(),
      sources: { fetch: async () => ({ content: "x" }) },
      logDir: "/tmp/agentic-test-logs",
      now: () => Date.now(),
    });
    const res = await app.request("/run", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: "Bearer tok" },
      body: JSON.stringify({ entity_ref: "todoist:task:abc" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.accepted).toBe(true);
  });

  test("missing auth → 401", async () => {
    const app = buildServer({
      token: "tok",
      convexClient: fakeConvex,
      runner: createEchoRunner(),
      sources: { fetch: async () => ({ content: "x" }) },
      logDir: "/tmp/agentic-test-logs",
      now: () => Date.now(),
    });
    const res = await app.request("/run", { method: "POST" });
    expect(res.status).toBe(401);
  });

  test("GET /healthz does not require auth", async () => {
    const app = buildServer({
      token: "tok",
      convexClient: fakeConvex,
      runner: createEchoRunner(),
      sources: { fetch: async () => ({ content: "x" }) },
      logDir: "/tmp/agentic-test-logs",
      now: () => Date.now(),
    });
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Replace server.ts with full wiring**

`engine/src/server.ts`:
```ts
import { Hono } from "hono";
import { ConvexHttpClient } from "convex/browser";
import { loadEnv } from "./env";
import { bearerAuth } from "./auth";
import { createLogger } from "./logging/logger";
import { createNdjsonAppender } from "./logging/ndjson";
import { createIdempotencyCache } from "./concurrency/idempotencyCache";
import { createPerEntityQueue } from "./concurrency/perEntityQueue";
import { createConvexStore } from "./store/convex";
import { createSourceRegistry } from "./sources/registry";
import { createTodoistTaskSource } from "./sources/todoistTask";
import type { AgentRunner } from "./runner/types";
import { createClaudeSdkRunner } from "./runner/claudeSdkRunner";
import { createRunRoutes } from "./routes/run";
import { createReadRoutes } from "./routes/readRun";
import { createInterruptRoute } from "./routes/interrupt";
import { createHealthRoute } from "./routes/health";
import { deliverWebhook } from "./webhook/deliver";

export interface BuildServerOpts {
  token: string;
  convexClient: ConvexHttpClient;
  runner: AgentRunner;
  sources: { fetch: (entity_ref: string) => Promise<unknown> };
  logDir: string;
  now?: () => number;
}

export function buildServer(opts: BuildServerOpts) {
  const startedAt = opts.now?.() ?? Date.now();
  const log = createLogger();
  const ndjson = createNdjsonAppender({ baseDir: opts.logDir });
  const cache = createIdempotencyCache({ ttlMs: 24 * 60 * 60 * 1000 });
  const store = createConvexStore(opts.convexClient);

  let inflight = 0;
  let lastError: { ts: number; message: string } | null = null;
  const queue = createPerEntityQueue({
    onInterrupt: async (ref) => opts.runner.interrupt(ref),
  });
  const wrappedQueue: typeof queue = {
    ...queue,
    enqueue(entity_ref, task) {
      inflight++;
      return queue.enqueue(entity_ref, async () => {
        try {
          return await task();
        } catch (e) {
          lastError = { ts: Date.now(), message: (e as Error).message };
          throw e;
        } finally {
          inflight--;
        }
      });
    },
  };

  const app = new Hono();

  app.route("/", createHealthRoute({
    startedAt,
    inflightCount: () => inflight,
    lastError: () => lastError,
    convexOk: () => true,
  }));

  const protectedApp = new Hono();
  protectedApp.use("*", bearerAuth(opts.token));
  protectedApp.route("/", createRunRoutes({
    store,
    queue: wrappedQueue,
    cache,
    runner: opts.runner,
    sources: opts.sources,
    ndjson,
    webhookDeliver: deliverWebhook,
  }));
  protectedApp.route("/", createReadRoutes({
    store,
    isBusy: (ref) => queue.isBusy(ref),
  }));
  protectedApp.route("/", createInterruptRoute({ queue: wrappedQueue, store }));

  app.route("/", protectedApp);

  app.onError((err, c) => {
    log.error("unhandled", { err });
    return c.json({ error: err.message }, 500);
  });

  return app;
}

if (import.meta.main) {
  const env = loadEnv();
  const log = createLogger();
  const convexClient = new ConvexHttpClient(env.convexUrl);
  const runner = createClaudeSdkRunner();
  const sources = createSourceRegistry({
    todoist_task: createTodoistTaskSource(convexClient),
  });
  const app = buildServer({
    token: env.token,
    convexClient,
    runner,
    sources,
    logDir: env.logDir,
  });
  log.info("agentic-engine.boot", { port: env.port, log_dir: env.logDir });
  Bun.serve({ port: env.port, fetch: app.fetch });
}
```

NOTE: This file imports `createClaudeSdkRunner` which doesn't exist yet — we land it in Task 28. Until then, the bottom `if (import.meta.main)` block fails to run, but the importable `buildServer` works and is exercised by the integration test using `createEchoRunner` instead. The Task 27 commit should still typecheck because `createClaudeSdkRunner` will be stubbed in Task 28's first step. **As a temporary measure for Task 27 only:** add a stub at `engine/src/runner/claudeSdkRunner.ts`:

```ts
import type { AgentRunner } from "./types";
export function createClaudeSdkRunner(): AgentRunner {
  throw new Error("ClaudeSdkRunner not yet implemented — use EchoRunner in tests");
}
```

This stub is removed and replaced in Task 28.

- [ ] **Step 3: Run integration test**

```bash
bun test engine/test/integration.test.ts
bun --cwd engine tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add engine/src/server.ts engine/test/integration.test.ts engine/src/runner/claudeSdkRunner.ts
git commit -m "feat(engine): assemble server, integration test with EchoRunner"
```

---

## Task 28: ClaudeSdkRunner — real Claude Agent SDK adapter

This task has no unit tests; correctness is validated by a manual smoke run against a real Convex deployment + real Claude account in Task 29.

**Files:**
- Modify: `engine/src/runner/claudeSdkRunner.ts` (replaces stub from Task 27)

- [ ] **Step 1: Read the Claude Agent SDK reference**

```bash
# Locate the SDK and skim its top-level types.
ls node_modules/@anthropic-ai/claude-agent-sdk
cat node_modules/@anthropic-ai/claude-agent-sdk/package.json
```

Identify the `query()` function and the `SDKMessage` union — that's what we translate into `CanonicalEvent`.

- [ ] **Step 2: Implement**

`engine/src/runner/claudeSdkRunner.ts`:
```ts
import { randomUUID } from "node:crypto";
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ProposalSchema, type Proposal } from "./proposalSchema";
import type {
  AgentRunInput,
  AgentRunResult,
  AgentRunner,
  CanonicalEvent,
  CanonicalTerminalEvent,
} from "./types";

interface SessionContext {
  session_id: string | null;
  abort: AbortController;
  turn_count: number;
}

export interface ClaudeSdkRunnerOpts {
  systemPrompt?: string;
  permissionMode?: "auto" | "ask" | "none";
  model?: string;
  cwd?: string;
}

const DEFAULT_SYSTEM = `You are the agentic engine's discover-and-propose runtime. On each turn:
1. Read the entity payload provided in the prompt.
2. Use available skills/MCPs to gather context.
3. Decide what to do, then emit EXACTLY ONE final assistant message that is a JSON object matching the Proposal schema (kind, summary, options[], free_text_allowed, optionally findings, recommended_option_id, question).
   Wrap the JSON in <proposal>...</proposal> tags.
4. If a user message starts with EXECUTE: <option_id>, perform that option using write tools and reply with a Proposal whose kind="execution_result".
Never emit free prose after the </proposal> tag.`;

export function createClaudeSdkRunner(opts: ClaudeSdkRunnerOpts = {}): AgentRunner {
  const sessions = new Map<string, SessionContext>();

  return {
    async run(input: AgentRunInput): Promise<AgentRunResult> {
      const ctx: SessionContext = sessions.get(input.entity_ref) ?? {
        session_id: (input.resume_cursor as any)?.session_id ?? null,
        abort: new AbortController(),
        turn_count: (input.resume_cursor as any)?.turn_count ?? 0,
      };
      sessions.set(input.entity_ref, ctx);

      const userPrompt = buildUserPrompt(input);
      const iterable = query({
        prompt: userPrompt,
        options: {
          systemPrompt: opts.systemPrompt ?? DEFAULT_SYSTEM,
          permissionMode: opts.permissionMode ?? "auto",
          model: opts.model,
          cwd: opts.cwd,
          resume: ctx.session_id ?? undefined,
          abortController: ctx.abort,
        },
      });

      let terminal: CanonicalTerminalEvent | null = null;
      let assistantBuffer = "";
      const activityKeys = new Map<string, string>();

      for await (const msg of iterable as AsyncIterable<SDKMessage>) {
        for (const e of normalize(msg, ctx, activityKeys)) {
          if (e.type === "proposal" || e.type === "execution_result" || e.type === "blocked" || e.type === "error") {
            terminal = e;
          }
          await input.on_event(e);
        }
        if ((msg as any).type === "assistant" && (msg as any).message?.content) {
          for (const part of (msg as any).message.content) {
            if (part.type === "text") assistantBuffer += part.text;
          }
        }
        if ((msg as any).type === "system" && (msg as any).subtype === "init") {
          ctx.session_id = (msg as any).session_id;
        }
      }

      if (!terminal) {
        const parsed = tryParseProposal(assistantBuffer);
        if (parsed) {
          terminal = {
            type: "proposal",
            proposal: parsed,
            checkpoint_id: randomUUID(),
          };
          await input.on_event(terminal);
        } else {
          terminal = {
            type: "error",
            error: { message: "no terminal event and no parseable proposal in transcript" },
          };
          await input.on_event(terminal);
        }
      }

      ctx.turn_count += 1;
      return {
        resume_cursor: {
          session_id: ctx.session_id,
          turn_count: ctx.turn_count,
        },
        terminal,
      };
    },
    async interrupt(entity_ref: string) {
      const ctx = sessions.get(entity_ref);
      if (ctx) {
        ctx.abort.abort();
        sessions.delete(entity_ref);
      }
    },
  };
}

function buildUserPrompt(input: AgentRunInput): string {
  return JSON.stringify({
    entity_ref: input.entity_ref,
    entity_payload: input.entity_payload,
    user_message: input.message,
  });
}

function normalize(
  msg: SDKMessage,
  ctx: SessionContext,
  activityKeys: Map<string, string>,
): CanonicalEvent[] {
  const events: CanonicalEvent[] = [];
  const m = msg as any;
  if (m.type === "assistant" && m.message?.content) {
    for (const part of m.message.content) {
      if (part.type === "text") {
        events.push({ type: "assistant_message", body_markdown: part.text });
      } else if (part.type === "thinking") {
        events.push({ type: "reasoning", body_markdown: part.text ?? "" });
      } else if (part.type === "tool_use") {
        const key = part.id ?? randomUUID();
        activityKeys.set(part.id ?? key, key);
        events.push({
          type: "tool_call_started",
          activity_key: key,
          name: part.name,
          input: part.input,
        });
      }
    }
  } else if (m.type === "user" && m.message?.content) {
    for (const part of m.message.content) {
      if (part.type === "tool_result") {
        const key = activityKeys.get(part.tool_use_id) ?? part.tool_use_id;
        events.push({
          type: "tool_call_resolved",
          activity_key: key,
          status: part.is_error ? "error" : "ok",
          output: part.content,
        });
      }
    }
  } else if (m.type === "result" && m.subtype === "success") {
    const parsed = tryParseProposal(m.result);
    if (parsed) {
      events.push({
        type: parsed.kind === "execution_result" ? "execution_result" : "proposal",
        proposal: parsed as Proposal,
        checkpoint_id: randomUUID(),
        body_markdown: parsed.summary,
      } as CanonicalEvent);
    }
  } else if (m.type === "result" && m.subtype !== "success") {
    events.push({
      type: "error",
      error: { message: `agent terminated with ${m.subtype}`, details: m },
    });
  }
  return events;
}

function tryParseProposal(text: string): Proposal | null {
  const open = text.indexOf("<proposal>");
  const close = text.lastIndexOf("</proposal>");
  if (open === -1 || close === -1 || close < open) return null;
  const json = text.slice(open + "<proposal>".length, close).trim();
  try {
    const obj = JSON.parse(json);
    return ProposalSchema.parse(obj);
  } catch {
    return null;
  }
}
```

NOTE: The exact `SDKMessage` shape may differ from what this code assumes (specifically the discriminator field names like `m.type === "assistant"` and the content-part shapes). The executor MUST verify against the actual installed SDK and adjust field accesses before committing. Test by running the manual smoke (Task 29) and iterating until a real entity_ref produces a `proposal` row in Convex.

- [ ] **Step 3: Typecheck and commit**

```bash
bun --cwd engine tsc --noEmit
git add engine/src/runner/claudeSdkRunner.ts
git commit -m "feat(engine): Claude Agent SDK runner adapter"
```

---

## Task 29: Manual smoke test against real Claude + Convex

This task is operational, not automated. It validates the full stack end-to-end and shakes out any SDK assumptions wrong in Task 28.

- [ ] **Step 1: Ensure Claude Code is authenticated on this machine**

```bash
claude --version
ls ~/.claude
# A `credentials.json` or similar should be present. If not: `claude login` interactively.
```

- [ ] **Step 2: Provision the bearer token in 1Password**

```bash
op item create --vault=Sol --category=Password --title="agentic-engine" \
  server_token="$(openssl rand -hex 24)" \
  convex_deploy_key="<your convex deploy key>"
```

Or if the item already exists, fetch with `op read op://Sol/agentic-engine/server_token`.

- [ ] **Step 3: Start the engine pointing at a Convex dev deployment**

```bash
# In one terminal:
bunx convex dev   # leave running

# In another:
AGENTIC_SERVER_TOKEN=$(op read op://Sol/agentic-engine/server_token) \
CONVEX_URL=$(op read op://Sol/agentic-engine/convex_dev_url) \
PORT=8787 \
LOG_DIR=$HOME/.agentic-engine/logs \
bun --cwd engine start
```

- [ ] **Step 4: Pick a real Todoist task and trigger a run**

```bash
# Find a task id you don't mind being touched.
TASK_ID=$(bunx convex run todoist:queries.getActiveItems | jq -r '.[0].id')
TOK=$(op read op://Sol/agentic-engine/server_token)
curl -s -X POST http://localhost:8787/run \
  -H "Authorization: Bearer $TOK" \
  -H "content-type: application/json" \
  -d "{\"entity_ref\":\"todoist:task:$TASK_ID\"}" | jq
```

Expected: `{ entity_ref, run_id, status: "discovering", accepted: true }`.

- [ ] **Step 5: Watch Convex for the proposal**

```bash
bunx convex run agentic:queries.getThread '{"entity_ref":"todoist:task:'$TASK_ID'"}' | jq
```

Expected: messages array containing at minimum a `proposal` row with non-null `proposal_json`.

- [ ] **Step 6: Capture findings**

Open the spec's "References" section and append any concrete deviations the SDK actually exhibited so future readers know. Then commit any fixes to `claudeSdkRunner.ts` discovered during smoke.

```bash
git add engine/src/runner/claudeSdkRunner.ts
git commit -m "fix(engine): adjust SDK event normalization to match real shape"
```

- [ ] **Step 7: Hand off to Task 30 only after a single full turn lands successfully**

---

## Task 30: launchd plist and Cloudflare Tunnel scaffolding

This produces operational artifacts. No automated test; manual verification.

**Files:**
- Create: `engine/deploy/com.milad.agentic-engine.plist`
- Create: `engine/deploy/cloudflared.yml.example`
- Create: `engine/README.md`

- [ ] **Step 1: launchd plist**

`engine/deploy/com.milad.agentic-engine.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.milad.agentic-engine</string>
    <key>ProgramArguments</key>
    <array>
      <string>/Users/milad/.bun/bin/bun</string>
      <string>--cwd</string>
      <string>/Users/milad/Documents/GitHub/master-db/engine</string>
      <string>start</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>/Users/milad/.bun/bin:/usr/local/bin:/usr/bin:/bin</string>
      <key>HOME</key>
      <string>/Users/milad</string>
      <key>LOG_DIR</key>
      <string>/Users/milad/.agentic-engine/logs</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/milad/.agentic-engine/launchd.out.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/milad/.agentic-engine/launchd.err.log</string>
  </dict>
</plist>
```

NOTE: `AGENTIC_SERVER_TOKEN` and `CONVEX_URL` must NOT be hard-coded in the plist. The plist should source them from a wrapper script that reads them via `op read`. Create `engine/deploy/start-with-secrets.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
export AGENTIC_SERVER_TOKEN="$(op read op://Sol/agentic-engine/server_token)"
export CONVEX_URL="$(op read op://Sol/agentic-engine/convex_url)"
exec bun --cwd "$(dirname "$0")/.." start
```

Then point the plist's `ProgramArguments` at the wrapper instead of `bun` directly.

- [ ] **Step 2: Cloudflare Tunnel example config**

`engine/deploy/cloudflared.yml.example`:
```yaml
tunnel: <tunnel-uuid>
credentials-file: /Users/milad/.cloudflared/<tunnel-uuid>.json

ingress:
  - hostname: agentic.yourdomain.tld
    service: http://localhost:8787
  - service: http_status:404
```

- [ ] **Step 3: README**

`engine/README.md`:
```markdown
# Agentic Engine

HTTP server wrapping the Claude Agent SDK for async, durable, multi-entity agentic decision-making runs.

Design: `../docs/superpowers/specs/2026-05-15-agentic-engine-web-server-design.md`

## Run locally

```bash
AGENTIC_SERVER_TOKEN=$(op read op://Sol/agentic-engine/server_token) \
CONVEX_URL=$(op read op://Sol/agentic-engine/convex_url) \
bun --cwd engine start
```

## Install as a launchd service

```bash
cp engine/deploy/com.milad.agentic-engine.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.milad.agentic-engine.plist
launchctl start com.milad.agentic-engine
```

## Cloudflare Tunnel

See `engine/deploy/cloudflared.yml.example`. Run `cloudflared` as a separate launchd agent.
```

- [ ] **Step 4: Install and verify**

```bash
chmod +x engine/deploy/start-with-secrets.sh
cp engine/deploy/com.milad.agentic-engine.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.milad.agentic-engine.plist
launchctl start com.milad.agentic-engine
tail -f ~/.agentic-engine/launchd.out.log
# Hit curl http://localhost:8787/healthz from another shell; expect 200.
```

- [ ] **Step 5: Commit**

```bash
git add engine/deploy engine/README.md
git commit -m "chore(engine): launchd plist, Cloudflare Tunnel example, README"
```

---

## Final validation

- [ ] **Step 1: Run the full validation gate**

```bash
bun run typecheck && bun run lint && bun test
```

Expected: all green.

- [ ] **Step 2: Smoke /healthz over the public URL (after Cloudflare Tunnel is up)**

```bash
curl https://agentic.yourdomain.tld/healthz
```

Expected: 200, `{"ok":true,...}`.

- [ ] **Step 3: Open the spec and verify every section has at least one corresponding task in this plan**

Checklist of spec sections → tasks:

- Architecture / repo layout → Tasks 1, 10
- HTTP API (POST /run + headers + idempotency) → Task 23
- HTTP API (wait) → Task 25
- HTTP API (cached read GET /run/:entity_ref) → Task 24
- HTTP API (GET /run/:entity_ref/status) → Task 24
- HTTP API (POST /run/:entity_ref/interrupt) → Task 25
- HTTP API (GET /healthz) → Task 26
- Client capabilities section → informational; surfaced through Convex projections built in Tasks 2–9
- Canonical event/item taxonomy + Proposal schema → Task 15
- Convex schema additions → Tasks 2–9
- AgentRunner interface → Task 15
- EntitySource interface → Tasks 17, 18
- Concurrency + idempotency cache → Tasks 20, 21
- Auth & secrets → Tasks 11, 12, 29, 30
- Forensic NDJSON shadow log → Task 14
- Lifecycle / deployment (launchd) → Task 30
- Testing strategy → spread across all tasks; integration test in Task 27
- Webhook callback shape → Task 22, used in 23
- Architectural rule (thin proxy) → enforced by design across Tasks 23–27; not a code task

If any spec section can't be mapped to a task above, add a follow-up task before declaring the plan complete.
