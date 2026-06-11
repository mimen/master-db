# Burndown Queue (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Plan is resumable via superpowers:plan-resume.

**Goal:** Build a two-column burndown queue page at `/agent` that lists every entity awaiting a decision and lets the user plow through them with keyboard plus a persistent right-pane agent surface.

**Architecture:** Two columns. Left = filter chips + sort dropdown + scrollable list of `QueueRow` components reading from a new Convex query `listAwaitingDecision`. Right = `AgentSurface` (extracted from the current `AgentDrawer` body) rendered for the keyboard-focused row. State (focused entity, filters, sort) lives in `QueueView`. Keyboard nav via a new `useAgentQueueKeybindings` hook.

**Tech Stack:** Bun, TypeScript strict, Vite, React 19, Tailwind v4, Convex, Wouter, shadcn/ui, vitest, `@testing-library/react`.

**Spec:** [`docs/superpowers/specs/2026-05-16-burndown-queue-design.md`](../specs/2026-05-16-burndown-queue-design.md). Read before starting Task 1.

**Validation gate per commit:** `bun --cwd app tsc --noEmit && bun run lint && bunx vitest run` — clean for files you touch. Pre-existing failures in unrelated files are NOT your responsibility.

**Solo-dev workflow:** Direct merge to main, no PR. Use `/usr/bin/git` (bypasses the `rtk` shell wrapper). Commit messages via `/usr/bin/git commit -F /tmp/<name>-msg.txt`; write the message file via the Write tool, not heredoc + `cat` (rtk intercepts).

**Parallel agent coordination:** Another agent is implementing Phase A of urgency scoring in parallel. Files they own — do NOT touch in this PR:
- `engine/src/runner/proposalSchema.ts`
- `engine/src/runner/claudeSdkRunner.ts`
- `convex/schema/agentic/agenticRuns.ts`
- `convex/agentic/mutations/appendThreadMessage.ts` (and any other proposal-write path)
- `app/src/components/agent/ProposalCard.tsx`
- `app/src/components/badges/shared/AgentStatusBadge.tsx`
- `app/src/lib/agent/proposalToParts.ts`

Whichever PR lands first, the other ff-merges cleanly. The sort in this plan's query is null-safe so it works with or without `last_urgency` populated.

---

## File structure

**New files:**
```
convex/agentic/queries/
  listAwaitingDecision.ts
  listAwaitingDecision.test.ts

app/src/components/agent/
  AgentSurface.tsx           ← extracted from AgentDrawer's body
  AgentSurface.test.tsx
  QueueView.tsx              ← orchestrator: state, layout, keyboard host
  QueueView.test.tsx
  QueueRow.tsx
  QueueRow.test.tsx
  QueueFilterBar.tsx
  QueueFilterBar.test.tsx
  QueueEmptyState.tsx        ← reused for no-matches / no-focus states

app/src/hooks/
  useAgentQueueKeybindings.ts
  useAgentQueueKeybindings.test.tsx
```

**Modified files:**
```
app/src/components/agent/AgentDrawer.tsx   ← slim down to mount AgentSurface
app/src/App.tsx                             ← add /agent route entry if needed
app/src/components/layout/Sidebar/sections/<...>  ← add sidebar entry
app/src/lib/views/<...>                     ← register new view key (see docs/adding-views-guide.md)
```

---

## Pre-flight (mandatory, 5 min)

- [ ] **Step 0.1: Pull main and verify clean tree**

```bash
cd ~/Documents/GitHub/master-db
/usr/bin/git checkout main && /usr/bin/git pull --ff-only
/usr/bin/git status --short
```

Expected: working tree clean. If dirty with files outside the parallel-agent file list, stash or investigate before continuing.

- [ ] **Step 0.2: Read the spec end-to-end**

Open `docs/superpowers/specs/2026-05-16-burndown-queue-design.md`. Pay attention to the file layout, the keyboard model table, and the "Coordination with the urgency PR" section.

- [ ] **Step 0.3: Read the views guide**

The app uses a custom view-key registry, not raw wouter Routes. Open `docs/adding-views-guide.md` and skim — Task 7 follows this 10-step process.

- [ ] **Step 0.4: Baseline tests pass**

```bash
cd ~/Documents/GitHub/master-db
bun --cwd app tsc --noEmit
bunx vitest run app/src
```

Expected: green (pre-existing failures elsewhere are fine; new errors in files you'll touch are not).

---

## Task 1: Extract `AgentSurface` from `AgentDrawer`

**Goal:** Move the `AgentDrawerBody` inner function out of `AgentDrawer.tsx` into a standalone `AgentSurface.tsx`. Drawer becomes a thin Sheet wrapper. No behavior change.

**Files:**
- Create: `app/src/components/agent/AgentSurface.tsx`
- Create: `app/src/components/agent/AgentSurface.test.tsx`
- Modify: `app/src/components/agent/AgentDrawer.tsx`

**Branch:** `agent-queue` (long-lived through Task 8)

### Step 1.1: Create the branch

```bash
cd ~/Documents/GitHub/master-db
/usr/bin/git checkout -b agent-queue main
/usr/bin/git reset HEAD
/usr/bin/git status --short
```

Expected: branch created. `git status --short` should be empty (no phantom staged files).

### Step 1.2: Create `AgentSurface.tsx`

Copy the body of `AgentDrawerBody` (currently inside `AgentDrawer.tsx`) into a new file. Same JSX, same imports, same logic. The component takes a single prop `entity_ref: string`.

`app/src/components/agent/AgentSurface.tsx`:

```tsx
import { useAction } from "convex/react"
import { useEffect, useRef } from "react"

import { AgentComposer } from "./AgentComposer"
import { AgentTranscript } from "./AgentTranscript"
import { StatusPill } from "./StatusPill"
import { ThinkingIndicator } from "./ThinkingIndicator"

import { SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { api } from "@/convex/_generated/api"
import { useAgentRuntime } from "@/hooks/useAgentRuntime"

/**
 * The inline agent body — transcript, composer, status pill, thinking
 * indicator. Used in two places:
 *  1. <AgentDrawer> wraps this in a shadcn Sheet for the modal drawer.
 *  2. <QueueView> renders this inline in its right column.
 *
 * Auto-trigger on mount: POST /run with message=null and a stable
 * idempotency key (entity_ref-only — see the original comment for the
 * StrictMode reasoning).
 */
export function AgentSurface({ entity_ref }: { entity_ref: string }) {
  const { run, isRunning } = useAgentRuntime(entity_ref)
  const startedAtRef = useRef<number | null>(null)
  if (isRunning && startedAtRef.current === null) startedAtRef.current = Date.now()
  if (!isRunning) startedAtRef.current = null

  const postRunAction = useAction(api.agentic.actions.postRun.default)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await postRunAction({
          entity_ref,
          message: null,
          idempotency_key: `${entity_ref}:open`,
          multitask_strategy: "enqueue",
        })
        if (cancelled) return
        void res
      } catch (err) {
        console.warn("[agent] auto-trigger failed", err)
      }
    })()
    return () => { cancelled = true }
  }, [entity_ref]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <SheetHeader className="px-4 py-3 border-b flex items-center justify-between flex-row">
        <SheetTitle className="text-sm">
          <span className="font-mono text-xs text-muted-foreground">{entity_ref}</span>
        </SheetTitle>
        <SheetDescription className="sr-only">
          Agent thread for entity {entity_ref}. Transcript, decisions, and composer below.
        </SheetDescription>
        <StatusPill status={run?.status ?? "idle"} />
      </SheetHeader>
      <div className="flex-1 overflow-y-auto p-4">
        <AgentTranscript entity_ref={entity_ref} />
        {isRunning && startedAtRef.current && (
          <ThinkingIndicator startedAt={startedAtRef.current} />
        )}
      </div>
      <div className="border-t p-3">
        <AgentComposer entity_ref={entity_ref} isRunning={isRunning} />
      </div>
    </>
  )
}
```

NOTE: `SheetHeader` / `SheetTitle` / `SheetDescription` are imported from shadcn's Sheet primitive even though we'll use this outside a Sheet too. They render as plain divs without a Sheet context. If lint or a11y warnings complain in the queue-view-no-Sheet case, swap to plain `<div>` with the same classes — but verify visually first; current behavior is fine.

### Step 1.3: Slim down `AgentDrawer.tsx`

Replace the inline `AgentDrawerBody` function with a call to `AgentSurface`.

`app/src/components/agent/AgentDrawer.tsx` (full replacement):

```tsx
import { AgentSurface } from "./AgentSurface"

import { Sheet, SheetContent } from "@/components/ui/sheet"
import { AgentComposerProvider } from "@/contexts/AgentComposerContext"
import { useAgentDrawer } from "@/contexts/AgentDrawerContext"

export function AgentDrawer() {
  const { isOpen, activeEntityRef, close } = useAgentDrawer()
  return (
    <Sheet open={isOpen} onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" className="sm:max-w-[640px] p-0 flex flex-col h-full">
        <AgentComposerProvider>
          {activeEntityRef ? <AgentSurface entity_ref={activeEntityRef} /> : null}
        </AgentComposerProvider>
      </SheetContent>
    </Sheet>
  )
}
```

### Step 1.4: Write the AgentSurface smoke test

`app/src/components/agent/AgentSurface.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

vi.mock("convex/react", () => ({
  useAction: () => vi.fn().mockResolvedValue({ accepted: true }),
  useQuery: vi.fn().mockReturnValue(undefined),
}))
vi.mock("@/convex/_generated/api", () => ({
  api: {
    agentic: {
      actions: { postRun: { default: "stub" } },
      queries: { getThread: { default: "stub" }, getRun: { default: "stub" } },
    },
  },
}))
vi.mock("@/hooks/useAgentRuntime", () => ({
  useAgentRuntime: () => ({
    runtime: { _kind: "runtime" },
    rows: [],
    run: { status: "awaiting_decision" },
    isRunning: false,
    isLoading: false,
  }),
}))

import { AgentComposerProvider } from "@/contexts/AgentComposerContext"
import { AgentSurface } from "./AgentSurface"

describe("AgentSurface", () => {
  test("renders entity_ref in the header", () => {
    render(
      <AgentComposerProvider>
        <AgentSurface entity_ref="todoist:task:abc" />
      </AgentComposerProvider>,
    )
    expect(screen.getByText("todoist:task:abc")).toBeInTheDocument()
  })

  test("renders status pill from run.status", () => {
    render(
      <AgentComposerProvider>
        <AgentSurface entity_ref="todoist:task:abc" />
      </AgentComposerProvider>,
    )
    expect(screen.getByText(/Awaiting you/i)).toBeInTheDocument()
  })
})
```

### Step 1.5: Run tests + validate

```bash
cd ~/Documents/GitHub/master-db
bun --cwd app tsc --noEmit
bunx vitest run app/src/components/agent/AgentSurface.test.tsx app/src/components/agent/AgentDrawer.test.tsx
```

Expected: typecheck clean. AgentSurface tests pass (2/2). AgentDrawer tests still pass (extraction is behavior-preserving; if AgentDrawer.test.tsx now mocks `AgentTranscript` instead of `AgentSurface`, add a `vi.mock("./AgentSurface")` to it).

If `AgentDrawer.test.tsx` breaks, the fix is usually adding:
```tsx
vi.mock("./AgentSurface", () => ({ AgentSurface: () => <div data-testid="agent-surface" /> }))
```
to the top of the test file's mocks block.

### Step 1.6: Commit

Write `/tmp/task1-msg.txt`:

```
refactor(agent): extract AgentSurface from AgentDrawer body

No behavior change. The drawer body (transcript + composer + status pill
+ thinking indicator + auto-trigger effect) moves into a standalone
AgentSurface component. AgentDrawer keeps the Sheet wrapper. QueueView
in Task 6 will render AgentSurface inline in its right column,
without the Sheet.
```

```bash
cd ~/Documents/GitHub/master-db
/usr/bin/git status --short
/usr/bin/git add -- app/src/components/agent/AgentSurface.tsx \
                    app/src/components/agent/AgentSurface.test.tsx \
                    app/src/components/agent/AgentDrawer.tsx \
                    app/src/components/agent/AgentDrawer.test.tsx
/usr/bin/git diff --cached --name-only
/usr/bin/git commit -F /tmp/task1-msg.txt
/usr/bin/git show --stat HEAD | tail -10
rm /tmp/task1-msg.txt
```

Expected: 4 files in the commit (3 new + AgentDrawer slim-down + possibly AgentDrawer.test.tsx mock). NOT more.

---

## Task 2: Convex query `listAwaitingDecision`

**Goal:** A reactive query returning agentic-engine runs in the user's queue, joined to the Todoist task content, sorted by `last_urgency desc` (nulls last) → `updated_at desc`.

**Files:**
- Create: `convex/agentic/queries/listAwaitingDecision.ts`
- Create: `convex/agentic/queries/listAwaitingDecision.test.ts`

### Step 2.1: Write the failing test

`convex/agentic/queries/listAwaitingDecision.test.ts`:

```ts
import { convexTest } from "convex-test"
import { describe, expect, test } from "vitest"
import schema from "../../schema"
import { api } from "../../_generated/api"
import { ALLOWED_EMAIL } from "../../_lib/authed"
import { normalizeModules } from "../../test-utils.vitest"

// listAwaitingDecision is an authedQuery — assertAllowed() rejects any call
// without an authenticated identity, so EVERY test below must build `t` as
// `convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL })`.
// The `modules` glob is required for convex-test to resolve function modules.
const modules = normalizeModules(
  import.meta.glob("../../**/*.*s"),
  import.meta.url,
)

// Helper: seed a run + task pair.
async function seedRun(
  t: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
  args: {
    entity_id: string
    status: string
    last_urgency?: number | null
    updated_at?: number
    task_content?: string
  },
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("agenticRuns", {
      entity_ref: `todoist:task:${args.entity_id}`,
      entity_type: "todoist_task",
      entity_id: args.entity_id,
      backend: "claude_sdk",
      resume_cursor: null,
      status: args.status,
      last_message_id: null,
      last_run_id: "01H",
      last_traceparent: null,
      // last_urgency is now on the schema (urgency PR merged) as an optional
      // field; only set it when the test case provides one.
      ...(args.last_urgency !== undefined && { last_urgency: args.last_urgency }),
      updated_at: args.updated_at ?? Date.now(),
    })
    await ctx.db.insert("todoist_items", {
      todoist_id: args.entity_id,
      content: args.task_content ?? `Task ${args.entity_id}`,
      // Minimal required fields — adjust if convex-test complains about the
      // actual schema's required fields.
    } as never)
  })
}

describe("listAwaitingDecision", () => {
  test("returns only the requested statuses (default awaiting_decision)", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL })
    await seedRun(t, { entity_id: "a", status: "awaiting_decision" })
    await seedRun(t, { entity_id: "b", status: "idle" })
    await seedRun(t, { entity_id: "c", status: "discovering" })

    const rows = await t.query(api.agentic.queries.listAwaitingDecision.default, {})
    expect(rows.map((r) => r.entity_id).sort()).toEqual(["a"])
  })

  test("explicit statuses union", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL })
    await seedRun(t, { entity_id: "a", status: "awaiting_decision" })
    await seedRun(t, { entity_id: "b", status: "error" })
    await seedRun(t, { entity_id: "c", status: "idle" })

    const rows = await t.query(api.agentic.queries.listAwaitingDecision.default, {
      statuses: ["awaiting_decision", "error"],
    })
    expect(rows.map((r) => r.entity_id).sort()).toEqual(["a", "b"])
  })

  test("urgency sort: higher urgency first, nulls last, ties on updated_at desc", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL })
    await seedRun(t, { entity_id: "a", status: "awaiting_decision", last_urgency: 0.5, updated_at: 100 })
    await seedRun(t, { entity_id: "b", status: "awaiting_decision", last_urgency: 0.9, updated_at: 50 })
    await seedRun(t, { entity_id: "c", status: "awaiting_decision", last_urgency: null, updated_at: 200 })
    await seedRun(t, { entity_id: "d", status: "awaiting_decision", last_urgency: 0.9, updated_at: 75 })

    const rows = await t.query(api.agentic.queries.listAwaitingDecision.default, {
      sort: "urgency",
    })
    expect(rows.map((r) => r.entity_id)).toEqual(["d", "b", "a", "c"])
  })

  test("recent sort: updated_at desc regardless of urgency", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL })
    await seedRun(t, { entity_id: "a", status: "awaiting_decision", last_urgency: 0.99, updated_at: 100 })
    await seedRun(t, { entity_id: "b", status: "awaiting_decision", last_urgency: null, updated_at: 200 })

    const rows = await t.query(api.agentic.queries.listAwaitingDecision.default, {
      sort: "recent",
    })
    expect(rows.map((r) => r.entity_id)).toEqual(["b", "a"])
  })

  test("joins task content from todoist_items", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL })
    await seedRun(t, { entity_id: "a", status: "awaiting_decision", task_content: "Email Sarah re: venue" })

    const rows = await t.query(api.agentic.queries.listAwaitingDecision.default, {})
    expect(rows[0]?.entity_title).toBe("Email Sarah re: venue")
  })

  test("limit clamps at 500", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL })
    for (let i = 0; i < 10; i++) {
      await seedRun(t, { entity_id: `i${i}`, status: "awaiting_decision", updated_at: i })
    }
    const rows = await t.query(api.agentic.queries.listAwaitingDecision.default, {
      limit: 5,
    })
    expect(rows).toHaveLength(5)
  })
})
```

NOTE: If `convex-test` complains about required `todoist_items` fields when seeding, look at `convex/schema/todoist/items.ts` and fill in any non-optional fields (the spread `as never` is a quick way past the type check; the actual schema may require things like `todoist_id`, `content`, plus a few other fields. Add them with sensible defaults).

### Step 2.2: Run, expect fail

```bash
cd ~/Documents/GitHub/master-db
bunx vitest run convex/agentic/queries/listAwaitingDecision.test.ts
```

Expected: FAIL — module not found.

### Step 2.3: Implement

`convex/agentic/queries/listAwaitingDecision.ts`:

```ts
import { v } from "convex/values"
import { authedQuery } from "../../_lib/authed"

export default authedQuery({
  args: {
    statuses: v.optional(v.array(v.string())),
    sort: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const statuses = args.statuses ?? ["awaiting_decision"]
    const limit = Math.min(args.limit ?? 200, 500)
    const sort = args.sort ?? "urgency"

    // Pull rows for each requested status, then union. Pick the index that
    // matches the candidate set we need so .take(limit) keeps the right rows:
    //   - urgency sort → by_status_and_urgency, desc. Verified ordering:
    //     numbers descending first, then null/undefined last. So take(limit)
    //     keeps the highest-urgency rows (NOT a recency-prefiltered subset).
    //   - recent/oldest → by_status_and_updated_at (desc for recent/urgency
    //     tiebreak fallback, asc for oldest).
    const allRows: Array<Record<string, unknown>> = []
    for (const status of statuses) {
      const slice =
        sort === "urgency"
          ? await ctx.db
              .query("agenticRuns")
              .withIndex("by_status_and_urgency", (q) => q.eq("status", status))
              .order("desc")
              .take(limit)
          : await ctx.db
              .query("agenticRuns")
              .withIndex("by_status_and_updated_at", (q) => q.eq("status", status))
              .order(sort === "oldest" ? "asc" : "desc")
              .take(limit)
      allRows.push(...slice)
    }

    // Join task content. For todoist:task: entity_refs, look up
    // todoist_items by todoist_id. Other entity_types render as the raw
    // entity_ref until per-type joins are added.
    const enriched = await Promise.all(
      allRows.map(async (run) => {
        if (run.entity_type === "todoist_task") {
          const task = await ctx.db
            .query("todoist_items")
            .withIndex("by_todoist_id", (q) => q.eq("todoist_id", run.entity_id as string))
            .unique()
          return {
            ...run,
            entity_title: (task as { content?: string } | null)?.content ?? "(missing)",
          }
        }
        return { ...run, entity_title: run.entity_ref as string }
      }),
    )

    // Sort. urgency: last_urgency desc, nulls last, ties broken by updated_at desc.
    //        recent:  updated_at desc.
    //        oldest:  updated_at asc.
    const sorted = enriched.sort((a, b) => {
      const au = a.updated_at as number
      const bu = b.updated_at as number
      if (sort === "oldest") return au - bu
      if (sort === "recent") return bu - au
      // urgency:
      const aurg = a.last_urgency as number | null | undefined
      const burg = b.last_urgency as number | null | undefined
      const aNull = aurg == null
      const bNull = burg == null
      if (aNull && bNull) return bu - au
      if (aNull) return 1
      if (bNull) return -1
      if (aurg !== burg) return (burg as number) - (aurg as number)
      return bu - au
    })

    return sorted.slice(0, limit)
  },
})
```

NOTE on `last_urgency`: the urgency PR has merged — `last_urgency` is on `agenticRuns` as `v.optional(v.union(v.number(), v.null()))` and the `by_status_and_urgency` index (`["status", "last_urgency"]`) exists. The in-memory comparator still handles `undefined`/`null` identically (both sort last) so it stays correct for rows whose urgency hasn't been scored yet. The index choice above just ensures the urgency-sort candidate set is the highest-urgency rows rather than the most-recent ones.

NOTE on auth: `listAwaitingDecision` is an `authedQuery`, so `assertAllowed()` rejects any unauthenticated call. Every test in Step 2.1 builds `t` with `.withIdentity({ email: ALLOWED_EMAIL })` and passes the `modules` glob — omitting either makes all six tests fail with `ConvexError: Unauthorized`.

### Step 2.4: Codegen + verify

```bash
cd ~/Documents/GitHub/master-db
bunx convex dev --once
bunx vitest run convex/agentic/queries/listAwaitingDecision.test.ts
```

Expected: codegen succeeds (new query appears in `convex/_generated/api.d.ts`). Tests pass 6/6.

### Step 2.5: Commit

Write `/tmp/task2-msg.txt`:

```
feat(agent): listAwaitingDecision Convex query for the burndown queue

Returns agentic-engine runs in the user's queue, joined to Todoist task
content, with three sort modes (urgency / recent / oldest). Urgency
sort is null-safe so the query works whether or not the parallel
urgency-scoring PR has shipped last_urgency yet — nulls go to the bottom
and updated_at breaks ties.

Uses the existing by_status_and_updated_at index. Multi-status union
is per-status retrieval + post-merge (the existing index can't span
status values).
```

```bash
cd ~/Documents/GitHub/master-db
/usr/bin/git status --short
/usr/bin/git add -- convex/agentic/queries/listAwaitingDecision.ts \
                    convex/agentic/queries/listAwaitingDecision.test.ts \
                    convex/_generated/
/usr/bin/git diff --cached --name-only
/usr/bin/git commit -F /tmp/task2-msg.txt
rm /tmp/task2-msg.txt
```

Expected: 3 files (or 2 if `_generated` was already current).

---

## Task 3: `QueueRow` component

**Goal:** A single row in the queue list: source icon + title + status pill + urgency chip + relative timestamp. Click fires `onFocus(entity_ref)`. Focus state shows a left-accent + bg.

**Files:**
- Create: `app/src/components/agent/QueueRow.tsx`
- Create: `app/src/components/agent/QueueRow.test.tsx`

### Step 3.1: Test first

`app/src/components/agent/QueueRow.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"
import { QueueRow, type QueueRowItem } from "./QueueRow"

const item: QueueRowItem = {
  entity_ref: "todoist:task:abc",
  entity_type: "todoist_task",
  entity_title: "Email Sarah re: venue",
  status: "awaiting_decision",
  last_urgency: 0.92,
  updated_at: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
}

describe("QueueRow", () => {
  test("renders title + status pill + urgency chip", () => {
    render(<QueueRow item={item} focused={false} onFocus={() => {}} />)
    expect(screen.getByText(/Email Sarah/)).toBeInTheDocument()
    expect(screen.getByText(/Awaiting/i)).toBeInTheDocument()
    expect(screen.getByText("0.92")).toBeInTheDocument()
  })

  test("hides urgency chip when last_urgency is null", () => {
    render(
      <QueueRow
        item={{ ...item, last_urgency: null }}
        focused={false}
        onFocus={() => {}}
      />,
    )
    expect(screen.queryByText(/0\.\d/)).toBeNull()
  })

  test("click fires onFocus with the entity_ref", () => {
    const onFocus = vi.fn()
    render(<QueueRow item={item} focused={false} onFocus={onFocus} />)
    fireEvent.click(screen.getByRole("button"))
    expect(onFocus).toHaveBeenCalledWith("todoist:task:abc")
  })

  test("focused=true adds focus accent class", () => {
    const { container } = render(
      <QueueRow item={item} focused onFocus={() => {}} />,
    )
    expect(container.querySelector(".border-l-primary")).toBeTruthy()
  })
})
```

### Step 3.2: Run, expect fail

```bash
cd ~/Documents/GitHub/master-db
bunx vitest run app/src/components/agent/QueueRow.test.tsx
```

Expected: FAIL — module not found.

### Step 3.3: Implement

`app/src/components/agent/QueueRow.tsx`:

```tsx
import { Bot } from "lucide-react"

import { StatusPill } from "./StatusPill"

export interface QueueRowItem {
  entity_ref: string
  entity_type: string
  entity_title: string
  status: string
  last_urgency: number | null | undefined
  updated_at: number
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function urgencyClass(u: number): string {
  if (u >= 0.85) return "bg-rose-500/15 text-rose-600 border-rose-500/30"
  if (u >= 0.5) return "bg-amber-500/15 text-amber-700 border-amber-500/30"
  return "bg-muted text-muted-foreground border-border"
}

export function QueueRow({
  item,
  focused,
  onFocus,
}: {
  item: QueueRowItem
  focused: boolean
  onFocus: (entity_ref: string) => void
}) {
  const urgency = item.last_urgency
  return (
    <button
      type="button"
      onClick={() => onFocus(item.entity_ref)}
      className={`w-full text-left px-3 py-2 border-l-2 hover:bg-accent/40 transition-colors flex items-center gap-2 ${
        focused ? "bg-accent/60 border-l-primary" : "border-l-transparent"
      }`}
    >
      <Bot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="flex-1 truncate text-sm">{item.entity_title}</span>
      <StatusPill status={item.status} />
      {urgency != null && (
        <span
          className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${urgencyClass(urgency)}`}
        >
          {urgency.toFixed(2)}
        </span>
      )}
      <span className="text-[10px] text-muted-foreground shrink-0 w-14 text-right">
        {relativeTime(item.updated_at)}
      </span>
    </button>
  )
}
```

### Step 3.4: Verify

```bash
cd ~/Documents/GitHub/master-db
bunx vitest run app/src/components/agent/QueueRow.test.tsx
bun --cwd app tsc --noEmit
```

Expected: 4/4 pass, typecheck clean.

### Step 3.5: Commit

Write `/tmp/task3-msg.txt`:

```
feat(agent): QueueRow component for the burndown list

Compact row with source icon, truncated title, status pill, urgency
chip (band-colored by score, hidden when null), and relative
timestamp. Click fires onFocus(entity_ref). Focused state adds a
left-accent border + bg tint.
```

```bash
cd ~/Documents/GitHub/master-db
/usr/bin/git status --short
/usr/bin/git add -- app/src/components/agent/QueueRow.tsx \
                    app/src/components/agent/QueueRow.test.tsx
/usr/bin/git diff --cached --name-only
/usr/bin/git commit -F /tmp/task3-msg.txt
rm /tmp/task3-msg.txt
```

---

## Task 4: `QueueFilterBar` component

**Goal:** Status filter chips + sort dropdown above the queue list. Emits state changes via callbacks.

**Files:**
- Create: `app/src/components/agent/QueueFilterBar.tsx`
- Create: `app/src/components/agent/QueueFilterBar.test.tsx`

### Step 4.1: Test first

`app/src/components/agent/QueueFilterBar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"
import { QueueFilterBar } from "./QueueFilterBar"

const defaults = {
  statuses: ["awaiting_decision"],
  sort: "urgency" as const,
  onStatusesChange: vi.fn(),
  onSortChange: vi.fn(),
}

describe("QueueFilterBar", () => {
  test("renders all four status chips", () => {
    render(<QueueFilterBar {...defaults} />)
    expect(screen.getByText(/Awaiting/i)).toBeInTheDocument()
    expect(screen.getByText(/Thinking/i)).toBeInTheDocument()
    expect(screen.getByText(/Running/i)).toBeInTheDocument()
    expect(screen.getByText(/Error/i)).toBeInTheDocument()
  })

  test("active status chip has filled style", () => {
    const { container } = render(<QueueFilterBar {...defaults} />)
    const awaitingChip = screen.getByText(/Awaiting/i).closest("button")
    expect(awaitingChip?.className).toContain("bg-primary")
  })

  test("clicking a chip toggles status set", () => {
    const onStatusesChange = vi.fn()
    render(<QueueFilterBar {...defaults} onStatusesChange={onStatusesChange} />)
    fireEvent.click(screen.getByText(/Error/i))
    expect(onStatusesChange).toHaveBeenCalledWith(["awaiting_decision", "error"])
  })

  test("clicking the active chip removes it", () => {
    const onStatusesChange = vi.fn()
    render(<QueueFilterBar {...defaults} onStatusesChange={onStatusesChange} />)
    fireEvent.click(screen.getByText(/Awaiting/i))
    expect(onStatusesChange).toHaveBeenCalledWith([])
  })

  test("sort dropdown emits new sort on change", () => {
    const onSortChange = vi.fn()
    render(<QueueFilterBar {...defaults} onSortChange={onSortChange} />)
    // Native select fallback used for simplicity in tests; if shadcn Select
    // is used in production, this test asserts via the underlying HTML option.
    const dropdownTrigger = screen.getByLabelText(/Sort/i)
    fireEvent.change(dropdownTrigger, { target: { value: "recent" } })
    expect(onSortChange).toHaveBeenCalledWith("recent")
  })
})
```

### Step 4.2: Run, expect fail.

### Step 4.3: Implement

`app/src/components/agent/QueueFilterBar.tsx`:

```tsx
export type QueueSort = "urgency" | "recent" | "oldest"

export interface QueueFilterBarProps {
  statuses: string[]
  sort: QueueSort
  onStatusesChange: (statuses: string[]) => void
  onSortChange: (sort: QueueSort) => void
}

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "awaiting_decision", label: "Awaiting decision" },
  { value: "discovering", label: "Thinking" },
  { value: "executing", label: "Running" },
  { value: "error", label: "Error" },
]

const SORT_OPTIONS: Array<{ value: QueueSort; label: string }> = [
  { value: "urgency", label: "Urgency" },
  { value: "recent", label: "Most recent" },
  { value: "oldest", label: "Oldest" },
]

export function QueueFilterBar({
  statuses,
  sort,
  onStatusesChange,
  onSortChange,
}: QueueFilterBarProps) {
  function toggleStatus(value: string) {
    if (statuses.includes(value)) onStatusesChange(statuses.filter((s) => s !== value))
    else onStatusesChange([...statuses, value])
  }

  return (
    <div className="px-3 py-2 border-b flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1 flex-wrap">
        {STATUS_OPTIONS.map((opt) => {
          const active = statuses.includes(opt.value)
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggleStatus(opt.value)}
              className={`text-[11px] rounded-full px-2 py-0.5 border transition-colors ${
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:bg-accent/50"
              }`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
      <div className="ml-auto">
        <label className="text-[11px] text-muted-foreground mr-1" htmlFor="queue-sort">
          Sort
        </label>
        <select
          id="queue-sort"
          aria-label="Sort"
          value={sort}
          onChange={(e) => onSortChange(e.target.value as QueueSort)}
          className="text-[11px] rounded-md border bg-background px-1.5 py-0.5"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
```

NOTE: Native `<select>` instead of the shadcn `Select` for simplicity. Upgrade later if needed; the tests assert against the `change` event so they work either way.

### Step 4.4: Run, expect pass + commit

```bash
cd ~/Documents/GitHub/master-db
bunx vitest run app/src/components/agent/QueueFilterBar.test.tsx
bun --cwd app tsc --noEmit
```

Write `/tmp/task4-msg.txt`:

```
feat(agent): QueueFilterBar for status chips + sort dropdown

Multi-select status chips (Awaiting / Thinking / Running / Error) with
toggle-on-click semantics. Single-select sort dropdown (Urgency / Most
recent / Oldest). State lives in the parent via callbacks; persistence
to localStorage is a Phase 2 follow-up.
```

```bash
cd ~/Documents/GitHub/master-db
/usr/bin/git add -- app/src/components/agent/QueueFilterBar.tsx \
                    app/src/components/agent/QueueFilterBar.test.tsx
/usr/bin/git commit -F /tmp/task4-msg.txt
rm /tmp/task4-msg.txt
```

---

## Task 5: `useAgentQueueKeybindings` hook

**Goal:** Keyboard handler for the queue page. j/k navigate, 1/2/3 execute Nth option of the focused row, m focuses composer modify-mode, e executes recommended, esc clears focus.

**Files:**
- Create: `app/src/hooks/useAgentQueueKeybindings.ts`
- Create: `app/src/hooks/useAgentQueueKeybindings.test.tsx`

### Step 5.1: Test first

`app/src/hooks/useAgentQueueKeybindings.test.tsx`:

```tsx
// @vitest-environment jsdom
import { renderHook } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"
import { useAgentQueueKeybindings } from "./useAgentQueueKeybindings"

function dispatch(key: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
}

describe("useAgentQueueKeybindings", () => {
  test("j fires onNext", () => {
    const onNext = vi.fn()
    renderHook(() =>
      useAgentQueueKeybindings({ enabled: true, onNext, onPrev: vi.fn(), onExecuteOption: vi.fn(), onModify: vi.fn(), onExecuteRecommended: vi.fn(), onClearFocus: vi.fn() }),
    )
    dispatch("j")
    expect(onNext).toHaveBeenCalledOnce()
  })

  test("ArrowDown also fires onNext", () => {
    const onNext = vi.fn()
    renderHook(() =>
      useAgentQueueKeybindings({ enabled: true, onNext, onPrev: vi.fn(), onExecuteOption: vi.fn(), onModify: vi.fn(), onExecuteRecommended: vi.fn(), onClearFocus: vi.fn() }),
    )
    dispatch("ArrowDown")
    expect(onNext).toHaveBeenCalledOnce()
  })

  test("k / ArrowUp fire onPrev", () => {
    const onPrev = vi.fn()
    renderHook(() =>
      useAgentQueueKeybindings({ enabled: true, onNext: vi.fn(), onPrev, onExecuteOption: vi.fn(), onModify: vi.fn(), onExecuteRecommended: vi.fn(), onClearFocus: vi.fn() }),
    )
    dispatch("k")
    dispatch("ArrowUp")
    expect(onPrev).toHaveBeenCalledTimes(2)
  })

  test("1/2/3/4 fire onExecuteOption with the index", () => {
    const onExecuteOption = vi.fn()
    renderHook(() =>
      useAgentQueueKeybindings({ enabled: true, onNext: vi.fn(), onPrev: vi.fn(), onExecuteOption, onModify: vi.fn(), onExecuteRecommended: vi.fn(), onClearFocus: vi.fn() }),
    )
    dispatch("1"); dispatch("2"); dispatch("3"); dispatch("4")
    expect(onExecuteOption.mock.calls).toEqual([[0], [1], [2], [3]])
  })

  test("m fires onModify", () => {
    const onModify = vi.fn()
    renderHook(() =>
      useAgentQueueKeybindings({ enabled: true, onNext: vi.fn(), onPrev: vi.fn(), onExecuteOption: vi.fn(), onModify, onExecuteRecommended: vi.fn(), onClearFocus: vi.fn() }),
    )
    dispatch("m")
    expect(onModify).toHaveBeenCalledOnce()
  })

  test("e fires onExecuteRecommended", () => {
    const onExecuteRecommended = vi.fn()
    renderHook(() =>
      useAgentQueueKeybindings({ enabled: true, onNext: vi.fn(), onPrev: vi.fn(), onExecuteOption: vi.fn(), onModify: vi.fn(), onExecuteRecommended, onClearFocus: vi.fn() }),
    )
    dispatch("e")
    expect(onExecuteRecommended).toHaveBeenCalledOnce()
  })

  test("esc fires onClearFocus", () => {
    const onClearFocus = vi.fn()
    renderHook(() =>
      useAgentQueueKeybindings({ enabled: true, onNext: vi.fn(), onPrev: vi.fn(), onExecuteOption: vi.fn(), onModify: vi.fn(), onExecuteRecommended: vi.fn(), onClearFocus }),
    )
    dispatch("Escape")
    expect(onClearFocus).toHaveBeenCalledOnce()
  })

  test("typing in an input does not fire any binding", () => {
    const cbs = { onNext: vi.fn(), onPrev: vi.fn(), onExecuteOption: vi.fn(), onModify: vi.fn(), onExecuteRecommended: vi.fn(), onClearFocus: vi.fn() }
    renderHook(() => useAgentQueueKeybindings({ enabled: true, ...cbs }))
    const input = document.createElement("input")
    document.body.appendChild(input)
    input.focus()
    dispatch("j"); dispatch("1"); dispatch("m")
    document.body.removeChild(input)
    expect(cbs.onNext).not.toHaveBeenCalled()
    expect(cbs.onExecuteOption).not.toHaveBeenCalled()
    expect(cbs.onModify).not.toHaveBeenCalled()
  })

  test("enabled=false suppresses all bindings", () => {
    const cbs = { onNext: vi.fn(), onPrev: vi.fn(), onExecuteOption: vi.fn(), onModify: vi.fn(), onExecuteRecommended: vi.fn(), onClearFocus: vi.fn() }
    renderHook(() => useAgentQueueKeybindings({ enabled: false, ...cbs }))
    dispatch("j"); dispatch("Escape"); dispatch("1")
    expect(cbs.onNext).not.toHaveBeenCalled()
    expect(cbs.onExecuteOption).not.toHaveBeenCalled()
    expect(cbs.onClearFocus).not.toHaveBeenCalled()
  })
})
```

### Step 5.2: Run, expect fail.

### Step 5.3: Implement

`app/src/hooks/useAgentQueueKeybindings.ts`:

```ts
import { useEffect } from "react"

export interface UseAgentQueueKeybindingsOpts {
  enabled: boolean
  onNext: () => void
  onPrev: () => void
  onExecuteOption: (index: number) => void   // index 0..3 for keys 1..4
  onModify: () => void
  onExecuteRecommended: () => void
  onClearFocus: () => void
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  if (el.isContentEditable) return true
  return false
}

export function useAgentQueueKeybindings(opts: UseAgentQueueKeybindingsOpts) {
  useEffect(() => {
    if (!opts.enabled) return
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(document.activeElement)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      switch (e.key) {
        case "j":
        case "ArrowDown":
          opts.onNext()
          return
        case "k":
        case "ArrowUp":
          opts.onPrev()
          return
        case "1":
        case "2":
        case "3":
        case "4":
          opts.onExecuteOption(Number(e.key) - 1)
          return
        case "m":
          opts.onModify()
          return
        case "e":
          opts.onExecuteRecommended()
          return
        case "Escape":
          opts.onClearFocus()
          return
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [opts])
}
```

### Step 5.4: Run, expect pass + commit

Write `/tmp/task5-msg.txt`:

```
feat(agent): useAgentQueueKeybindings hook for queue keyboard nav

j/ArrowDown = next row, k/ArrowUp = prev row, 1-4 = execute that
option of the focused proposal, m = focus composer in modify mode,
e = execute recommended option, esc = clear focus. Typing-target guard
suppresses bindings when an input/textarea/select is focused.
enabled=false disables all bindings.
```

```bash
cd ~/Documents/GitHub/master-db
/usr/bin/git add -- app/src/hooks/useAgentQueueKeybindings.ts \
                    app/src/hooks/useAgentQueueKeybindings.test.tsx
/usr/bin/git commit -F /tmp/task5-msg.txt
rm /tmp/task5-msg.txt
```

---

## Task 6: `QueueView` orchestrator

**Goal:** The main page component. Holds state (focused entity, filter statuses, sort). Renders the filter bar, the list of QueueRows, and the right-pane AgentSurface. Wires the keyboard hook.

**Files:**
- Create: `app/src/components/agent/QueueView.tsx`
- Create: `app/src/components/agent/QueueView.test.tsx`
- Create: `app/src/components/agent/QueueEmptyState.tsx`

### Step 6.1: QueueEmptyState (small helper)

`app/src/components/agent/QueueEmptyState.tsx`:

```tsx
import { Inbox } from "lucide-react"

export function QueueEmptyState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-muted-foreground">
      <div className="flex flex-col items-center gap-2">
        <Inbox className="h-6 w-6 opacity-50" />
        <p className="text-sm">{message}</p>
      </div>
    </div>
  )
}
```

### Step 6.2: QueueView test

`app/src/components/agent/QueueView.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

const sampleItems = [
  {
    entity_ref: "todoist:task:a",
    entity_type: "todoist_task",
    entity_id: "a",
    entity_title: "First task",
    status: "awaiting_decision",
    last_urgency: 0.9,
    updated_at: 100,
  },
  {
    entity_ref: "todoist:task:b",
    entity_type: "todoist_task",
    entity_id: "b",
    entity_title: "Second task",
    status: "awaiting_decision",
    last_urgency: 0.5,
    updated_at: 50,
  },
]

vi.mock("convex/react", () => ({
  useQuery: () => sampleItems,
  useAction: () => vi.fn().mockResolvedValue({ accepted: true }),
}))
vi.mock("@/convex/_generated/api", () => ({
  api: {
    agentic: {
      queries: {
        listAwaitingDecision: { default: "stub" },
        getThread: { default: "stub" },
        getRun: { default: "stub" },
      },
      actions: { postRun: { default: "stub" } },
    },
  },
}))
vi.mock("./AgentSurface", () => ({
  AgentSurface: ({ entity_ref }: { entity_ref: string }) => (
    <div data-testid="agent-surface">{entity_ref}</div>
  ),
}))

import { QueueView } from "./QueueView"

describe("QueueView", () => {
  test("renders both rows from the query", () => {
    render(<QueueView />)
    expect(screen.getByText("First task")).toBeInTheDocument()
    expect(screen.getByText("Second task")).toBeInTheDocument()
  })

  test("clicking a row focuses it; right pane shows AgentSurface for it", () => {
    render(<QueueView />)
    fireEvent.click(screen.getByText("Second task"))
    expect(screen.getByTestId("agent-surface")).toHaveTextContent("todoist:task:b")
  })

  test("empty state when query returns []", () => {
    vi.doMock("convex/react", () => ({
      useQuery: () => [],
      useAction: () => vi.fn(),
    }))
    // Need to re-import after the doMock
    return import("./QueueView").then(({ QueueView: FreshQueueView }) => {
      render(<FreshQueueView />)
      expect(screen.getByText(/Nothing awaiting/i)).toBeInTheDocument()
    })
  })
})
```

NOTE: The empty-state test is fiddly with `vi.doMock` + dynamic import. If it's flaky, replace with a direct test of `<QueueView>` rendering inside a wrapper that injects a mock useQuery; or split the empty-state check into a unit test of just `QueueEmptyState`.

### Step 6.3: Implement QueueView

`app/src/components/agent/QueueView.tsx`:

```tsx
import { useQuery } from "convex/react"
import { useState } from "react"

import { AgentSurface } from "./AgentSurface"
import { type QueueSort, QueueFilterBar } from "./QueueFilterBar"
import { QueueEmptyState } from "./QueueEmptyState"
import { QueueRow, type QueueRowItem } from "./QueueRow"

import { AgentComposerProvider } from "@/contexts/AgentComposerContext"
import { api } from "@/convex/_generated/api"
import { useAgentQueueKeybindings } from "@/hooks/useAgentQueueKeybindings"

export function QueueView() {
  const [statuses, setStatuses] = useState<string[]>(["awaiting_decision"])
  const [sort, setSort] = useState<QueueSort>("urgency")
  const [focused, setFocused] = useState<string | null>(null)

  const rows = useQuery(api.agentic.queries.listAwaitingDecision.default, {
    statuses,
    sort,
  }) as QueueRowItem[] | undefined

  const items = rows ?? []
  const focusedIndex = focused ? items.findIndex((r) => r.entity_ref === focused) : -1

  // Auto-focus first row on load. Clear focus if it falls out of the list.
  if (items.length > 0 && focused == null) {
    queueMicrotask(() => setFocused(items[0].entity_ref))
  }
  if (focused != null && focusedIndex === -1 && items.length > 0) {
    queueMicrotask(() => setFocused(items[0].entity_ref))
  }

  useAgentQueueKeybindings({
    enabled: true,
    onNext: () => {
      if (items.length === 0) return
      const idx = focusedIndex === -1 ? 0 : Math.min(focusedIndex + 1, items.length - 1)
      setFocused(items[idx].entity_ref)
    },
    onPrev: () => {
      if (items.length === 0) return
      const idx = focusedIndex === -1 ? 0 : Math.max(focusedIndex - 1, 0)
      setFocused(items[idx].entity_ref)
    },
    onExecuteOption: () => {
      // Forwarded to the focused AgentSurface via DOM event in a follow-up;
      // for v1 the user clicks Execute in the right pane.
      // TODO Phase 3: bridge keyboard execution into AgentSurface.
    },
    onModify: () => {
      // Same as above. TODO Phase 3.
    },
    onExecuteRecommended: () => {
      // Same as above. TODO Phase 3.
    },
    onClearFocus: () => setFocused(null),
  })

  return (
    <div className="flex h-full">
      {/* Left pane: filter bar + scrollable list */}
      <div className="w-[440px] shrink-0 flex flex-col border-r">
        <QueueFilterBar
          statuses={statuses}
          sort={sort}
          onStatusesChange={setStatuses}
          onSortChange={setSort}
        />
        {rows === undefined ? (
          <QueueEmptyState message="Loading…" />
        ) : items.length === 0 ? (
          <QueueEmptyState message="Nothing awaiting your decision. Inbox zero." />
        ) : (
          <div className="flex-1 overflow-y-auto">
            {items.map((item) => (
              <QueueRow
                key={item.entity_ref}
                item={item}
                focused={item.entity_ref === focused}
                onFocus={setFocused}
              />
            ))}
          </div>
        )}
      </div>

      {/* Right pane: focused entity's agent surface */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <AgentComposerProvider>
          {focused ? (
            <AgentSurface entity_ref={focused} />
          ) : (
            <QueueEmptyState message="Select a task to view its agent thread." />
          )}
        </AgentComposerProvider>
      </div>
    </div>
  )
}
```

NOTE on keyboard option-execute / modify / execute-recommended: these are wired as no-op TODOs in v1 because they require the focused AgentSurface to expose imperative handles (current architecture has the AgentSurface own its own state). Phase 3 polish — for now the user keyboards j/k to scan and clicks Execute / Modify in the right pane to decide. Documented in the JSX comments.

### Step 6.4: Run, expect pass + commit

```bash
cd ~/Documents/GitHub/master-db
bunx vitest run app/src/components/agent/QueueView.test.tsx
bun --cwd app tsc --noEmit
```

Write `/tmp/task6-msg.txt`:

```
feat(agent): QueueView orchestrator

Two-column layout: filter bar + scrollable QueueRow list on the left,
AgentSurface for the focused entity on the right. Holds state for
focused entity, filter statuses, sort. Wires useAgentQueueKeybindings
for j/k navigation; option execution / modify / execute-recommended
bindings are no-op TODOs in v1 (the focused AgentSurface owns its
own state; bridging keyboard action into it is Phase 3 polish).
```

```bash
cd ~/Documents/GitHub/master-db
/usr/bin/git add -- app/src/components/agent/QueueView.tsx \
                    app/src/components/agent/QueueView.test.tsx \
                    app/src/components/agent/QueueEmptyState.tsx
/usr/bin/git commit -F /tmp/task6-msg.txt
rm /tmp/task6-msg.txt
```

---

## Task 7: Register the `/agent` route + sidebar entry

**Goal:** Make QueueView accessible via `/agent`. Add a sidebar entry pointing to it.

**Files:**
- Modify: `app/src/lib/views/viewRegistry.tsx` — register a new view key
- Modify: `app/src/lib/views/types.ts` — add the view key to the `ViewKey` union
- Modify: `app/src/components/layout/Sidebar/sections/<...>` — sidebar entry
- Possibly modify: `app/src/components/layout/Layout.tsx` — if the view dispatches in Layout

The app uses a custom view-key registry, not raw wouter Routes. Follow `docs/adding-views-guide.md` (also at repo root level) — it's the canonical 10-step process. The high-level shape:

### Step 7.1: Read the guide

```bash
cd ~/Documents/GitHub/master-db
cat docs/adding-views-guide.md
```

Internalize the 10-step view-add process. Steps below mirror it.

### Step 7.2: Add `"agent-queue"` to ViewKey union

In `app/src/lib/views/types.ts`, find the `ViewKey` type and add `| "agent-queue"`.

### Step 7.3: Register in viewRegistry

In `app/src/lib/views/viewRegistry.tsx`, follow the existing registration pattern (look at how `dashboard` or `inbox` is registered for the shape — `match`, `path`, `expand`, etc.). The agent-queue is a single-list view; its path is `"/agent"`; it doesn't expand into multiple lists (it's a custom non-task view, so `expand` returns an empty array or however the registry signals "render a custom component").

If the registry doesn't have a clean slot for "custom component view" (one whose body isn't a TaskListView but a separate React component), you'll need to add one — look for where the existing views switch to their renderers in `Layout.tsx` and add a case for `agent-queue` that renders `<QueueView />`.

### Step 7.4: Wire the renderer in Layout

In `app/src/components/layout/Layout.tsx`, find where views are dispatched to renderers (likely a switch on `activeView.key`). Add:

```tsx
case "agent-queue":
  return <QueueView />
```

Import `QueueView` at the top of `Layout.tsx`.

### Step 7.5: Sidebar entry

Look at `app/src/components/layout/Sidebar/sections/` for the existing section files. Add a new entry pointing to `agent-queue`. Use a `Bot` icon from `lucide-react`. Label: "Agent queue".

If a section is appropriate (e.g. there's a "Main nav" section), append. Otherwise create a new minimal section file.

### Step 7.6: Verify in browser

```bash
cd ~/Documents/GitHub/master-db
bun --cwd app run dev
```

Visit `http://localhost:3000/agent`. Expected:
- Sidebar shows "Agent queue" entry.
- Clicking it (or visiting `/agent`) renders the QueueView.
- Rows render from the seeded agentic_runs data.

Stop the dev server.

### Step 7.7: Validate + commit

```bash
cd ~/Documents/GitHub/master-db
bun --cwd app tsc --noEmit
bun run lint
bunx vitest run app/src
```

Write `/tmp/task7-msg.txt`:

```
feat(agent): /agent route + sidebar entry for the burndown queue

Registers a new "agent-queue" view key, paths to "/agent", renders
QueueView. Adds a sidebar entry with a Bot icon labeled "Agent queue".
Follows the existing view-registry pattern documented in
docs/adding-views-guide.md.
```

```bash
cd ~/Documents/GitHub/master-db
/usr/bin/git status --short
/usr/bin/git add -- app/src/lib/views/types.ts \
                    app/src/lib/views/viewRegistry.tsx \
                    app/src/components/layout/Layout.tsx \
                    app/src/components/layout/Sidebar/
/usr/bin/git diff --cached --name-only
/usr/bin/git commit -F /tmp/task7-msg.txt
rm /tmp/task7-msg.txt
```

---

## Task 8: Integration test + final validation

**Goal:** One integration test that exercises the queue end-to-end: mounts QueueView, asserts rows render, focuses via j-keystroke, asserts right pane updates. Plus full validation gate before ff-merging the branch.

**Files:**
- Create: `app/test/agent-queue.integration.test.tsx`

### Step 8.1: Integration test

`app/test/agent-queue.integration.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

const items = [
  {
    entity_ref: "todoist:task:a",
    entity_type: "todoist_task",
    entity_id: "a",
    entity_title: "First task",
    status: "awaiting_decision",
    last_urgency: 0.9,
    updated_at: 100,
  },
  {
    entity_ref: "todoist:task:b",
    entity_type: "todoist_task",
    entity_id: "b",
    entity_title: "Second task",
    status: "awaiting_decision",
    last_urgency: 0.5,
    updated_at: 50,
  },
]

vi.mock("convex/react", () => ({
  useQuery: (fn: unknown) => {
    if (String(fn).includes("listAwaitingDecision")) return items
    return undefined
  },
  useAction: () => vi.fn().mockResolvedValue({ accepted: true }),
}))
vi.mock("@/convex/_generated/api", () => ({
  api: {
    agentic: {
      queries: {
        listAwaitingDecision: { default: "listAwaitingDecision" },
        getThread: { default: "getThread" },
        getRun: { default: "getRun" },
      },
      actions: { postRun: { default: "postRun" } },
    },
  },
}))
vi.mock("./AgentSurface", () => ({
  AgentSurface: ({ entity_ref }: { entity_ref: string }) => (
    <div data-testid="agent-surface">{entity_ref}</div>
  ),
}))

import { QueueView } from "@/components/agent/QueueView"

describe("agent queue integration", () => {
  test("open → rows render → j focuses next → right pane updates", async () => {
    render(<QueueView />)

    expect(await screen.findByText("First task")).toBeInTheDocument()
    expect(screen.getByText("Second task")).toBeInTheDocument()

    // First item should auto-focus
    await waitFor(() => {
      expect(screen.getByTestId("agent-surface")).toHaveTextContent("todoist:task:a")
    })

    // Press j to go to next row
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }))
    await waitFor(() => {
      expect(screen.getByTestId("agent-surface")).toHaveTextContent("todoist:task:b")
    })
  })
})
```

NOTE: The mock for `./AgentSurface` needs the right relative path resolution. Since this test is in `app/test/` and AgentSurface is in `app/src/components/agent/`, the alias is `@/components/agent/AgentSurface`. Adjust the mock target to whichever path Vite resolves to.

### Step 8.2: Run all tests

```bash
cd ~/Documents/GitHub/master-db
bunx vitest run app/test app/src
```

Expected: 100% pass for files you touched. Pre-existing failures elsewhere are not your concern.

### Step 8.3: Full validation gate

```bash
cd ~/Documents/GitHub/master-db
bun --cwd app tsc --noEmit
bun run lint
bunx vitest run
```

Expected: typecheck clean, lint clean in new files (pre-existing lint errors elsewhere ok), tests pass.

### Step 8.4: Manual smoke test

```bash
cd ~/Documents/GitHub/master-db
bun --cwd app run dev
```

Visit `http://localhost:3000/agent`. Verify:
- Sidebar entry visible and active.
- List of awaiting-decision entities renders.
- Click a row → right pane shows that entity's agent surface (status pill, transcript, composer).
- `j` / `k` change focused row + right pane updates.
- Filter chip click toggles statuses; list re-queries.
- Sort dropdown changes order.

Stop dev server.

### Step 8.5: Commit + merge to main

Write `/tmp/task8-msg.txt`:

```
feat(agent): integration test for burndown queue

Mounts QueueView against a mocked Convex + mocked AgentSurface, asserts
rows render, asserts j-keystroke advances focus + right pane updates.
End-to-end without a real engine.

Phase 2 burndown queue is complete:
- /agent route + sidebar entry
- listAwaitingDecision Convex query (null-safe urgency sort)
- AgentSurface refactor (shared with AgentDrawer)
- QueueRow + QueueFilterBar + QueueView + QueueEmptyState
- useAgentQueueKeybindings hook (j/k, esc; option execution TODO Phase 3)
- Integration + unit tests
```

```bash
cd ~/Documents/GitHub/master-db
/usr/bin/git status --short
/usr/bin/git add -- app/test/agent-queue.integration.test.tsx
/usr/bin/git commit -F /tmp/task8-msg.txt
rm /tmp/task8-msg.txt
```

### Step 8.6: Merge to main + push + sync worktree

```bash
cd ~/Documents/GitHub/master-db
/usr/bin/git checkout main
/usr/bin/git pull --ff-only origin main  # in case the urgency PR landed in parallel
/usr/bin/git checkout agent-queue
/usr/bin/git rebase main  # cleanly replay onto latest main; if conflicts, surface them
/usr/bin/git checkout main
/usr/bin/git merge --ff-only agent-queue
/usr/bin/git push origin main
/usr/bin/git branch -d agent-queue

# Sync worktree if it exists
if [ -d /tmp/master-db-test ]; then
  cd /tmp/master-db-test
  git fetch origin --quiet
  git reset --hard origin/main
fi
```

Expected: ff-merge clean (or conflicts surfaced — if so, resolve them by accepting the urgency PR's changes; nothing in this plan should overlap their files per the spec).

---

## Self-review checklist (run at plan-write time)

- ✅ Spec section "Purpose" — covered by QueueView (Task 6).
- ✅ Spec "Architecture" — every component named is created in a Task.
- ✅ Spec "AgentSurface refactor" — Task 1.
- ✅ Spec "QueueView layout" — Task 6.
- ✅ Spec "QueueRow" — Task 3.
- ✅ Spec "QueueFilterBar" — Task 4.
- ✅ Spec "AgentSurface in the right pane" — Task 1 + 6.
- ✅ Spec "Empty states" — Task 6 (QueueEmptyState).
- ✅ Spec "Keyboard model" — Task 5 (hook) + Task 6 (wiring). Note: 1-4/m/e are stubbed as no-ops in v1, per Task 6 NOTE. Documented in commit message.
- ✅ Spec "Data flow" — Task 2.
- ✅ Spec "File layout" — every file in the spec's layout appears in a Task.
- ✅ Spec "Coordination with the urgency PR" — pre-flight Step 0.1 + null-safe sort in Task 2 query + ff-rebase in Task 8.
- ✅ Spec "Tests" — every test target has a corresponding test file in a Task.

**Open follow-up items captured in Task NOTEs:**
1. Task 1: `SheetHeader` reuse outside of a Sheet may need cosmetic swap to plain divs.
2. Task 2: `todoist_items` schema's required fields not enumerated here; implementer fills the seed helper accordingly.
3. Task 6: keyboard option-execute / modify / execute-recommended bindings stubbed as TODOs (need imperative handles on AgentSurface — Phase 3 polish).
4. Task 7: view registry has not been read; implementer may need to extend it for a custom non-list view. Reference `docs/adding-views-guide.md`.
