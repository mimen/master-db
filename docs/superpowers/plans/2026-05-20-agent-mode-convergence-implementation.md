# Agent Mode Convergence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Plan is resumable via superpowers:plan-resume.

**Goal:** Make "agent mode" a toggle on single-list task views — same `TaskListView`/`TaskListItem`, decorated with a per-task agent overlay + a right-pane `AgentSurface` — and redefine the standalone agent queue as the "has agentic run" filter preset, retiring `QueueView`/`QueueRow`.

**Architecture:** Data flows **tasks → runs (overlay)**. The view's existing task query stays the source; a new batch query `agentOverlayByEntityRefs(entity_refs[])` returns `{ hasRun, status, last_urgency, last_chatted_at }` per task, merged onto the `TodoistTaskWithProject` rows as an optional `_agent` field. Agent mode = `TaskListView` wrapped in a `ResizablePanelGroup` (list left, `AgentSurface` right) + agent sort/filter options + the queue keybindings. No new row type — `TaskListItem` is reused (it already renders `AgentStatusBadge`). The agent-queue view becomes a preset: `agentMode` on + `agentFilter=has-run` + urgency sort.

**Tech stack:** Bun, TypeScript strict, React 19, Convex, wouter, shadcn, vitest, `@testing-library/react`.

**Spec:** [`docs/superpowers/specs/2026-05-20-agent-mode-convergence-design.md`](../specs/2026-05-20-agent-mode-convergence-design.md). Read before Task 1.

**Validation gate per commit:** `bun --cwd app tsc --noEmit && bun run typecheck:convex && bunx vitest run` — clean for files you touch (pre-existing unrelated failures are not your responsibility). Use `/usr/bin/git` (the `rtk` wrapper hijacks plain `git`/`cat`); write commit messages with the Write tool to `/tmp/<name>.txt` then `git commit -F`. No `npx` — use `bunx`. Run vitest from the repo root. Direct-merge to main once reviews pass (solo-dev convention); after Convex changes run `bunx convex dev --once` to push to the shared dev deployment.

**De-risk ordering:** Phase 1 (data overlay) and Phase 2 (read-only two-pane agent mode reusing TaskListView) prove the architecture before the heavier filter/sort/keyboard work. Each task is its own commit.

---

## File structure

**New:**
```
convex/agentic/queries/agentOverlayByEntityRefs.ts        (+ .test.ts)
app/src/lib/agent/agentOverlay.ts        ← types + client merge helper (+ .test.ts)
app/src/components/agent/AgentModeLayout.tsx   ← ResizablePanelGroup wrapper (list | AgentSurface) (+ .test.tsx)
app/src/components/agent/AgentModeToggle.tsx   ← header switch (+ .test.tsx)
```
**Modified:**
```
app/src/components/TaskListView.tsx        ← agentMode prop: merge overlay, wrap in AgentModeLayout, register toggle, wire selection→AgentSurface + keybindings
app/src/lib/views/types.ts                 ← agent sort/filter option ids; agentMode on ListQueryDefinition variants
app/src/lib/views/taskConfig.ts (or sortAndGroup)  ← urgency + last-chatted SortOptions; has-run/status filter
app/src/lib/views/listDefinitions.tsx + viewRegistry.tsx + Layout.tsx  ← agent-queue preset → TaskListView(agentMode) instead of QueueView
app/src/components/list-items/TaskListItem.tsx  ← accept optional `_agent` overlay for sort/decoration (status pill + urgency + last-chat) — reuse statusMeta
```
**Retired (final task):** `QueueView.tsx`, `QueueRow.tsx` (+ tests).

---

## Phase 1 — Agent overlay data

### Task 1: `agentOverlayByEntityRefs` batch query

**Files:**
- Create: `convex/agentic/queries/agentOverlayByEntityRefs.ts`
- Create: `convex/agentic/queries/agentOverlayByEntityRefs.test.ts`

- [ ] **Step 1: Write the failing test** — `agentOverlayByEntityRefs.test.ts`

```ts
import { convexTest } from "convex-test"
import { describe, expect, test } from "vitest"
import schema from "../../schema"
import { api } from "../../_generated/api"
import { ALLOWED_EMAIL } from "../../_lib/authed"
import { normalizeModules } from "../../test-utils.vitest"

const modules = normalizeModules(import.meta.glob("../../**/*.*s"), import.meta.url)

async function seedRun(t: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>, args: {
  entity_id: string; status: string; last_urgency?: number | null; updated_at?: number
}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("agenticRuns", {
      entity_ref: `todoist:task:${args.entity_id}`, entity_type: "todoist_task", entity_id: args.entity_id,
      backend: "claude_sdk", resume_cursor: null, status: args.status, last_message_id: null,
      last_run_id: "01H", last_traceparent: null,
      ...(args.last_urgency !== undefined && { last_urgency: args.last_urgency }),
      updated_at: args.updated_at ?? 100,
    })
  })
}

describe("agentOverlayByEntityRefs", () => {
  test("returns a map keyed by entity_ref with hasRun + status + urgency + last_chatted_at", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL })
    await seedRun(t, { entity_id: "a", status: "awaiting_decision", last_urgency: 0.9, updated_at: 500 })
    const map = await t.query(api.agentic.queries.agentOverlayByEntityRefs.default, {
      entity_refs: ["todoist:task:a", "todoist:task:missing"],
    })
    expect(map["todoist:task:a"]).toEqual({ hasRun: true, status: "awaiting_decision", last_urgency: 0.9, last_chatted_at: 500 })
    expect(map["todoist:task:missing"]).toBeUndefined()
  })

  test("empty input returns empty map", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL })
    const map = await t.query(api.agentic.queries.agentOverlayByEntityRefs.default, { entity_refs: [] })
    expect(map).toEqual({})
  })
})
```

- [ ] **Step 2: Run, expect fail** — `bunx vitest run convex/agentic/queries/agentOverlayByEntityRefs.test.ts` → module not found.

- [ ] **Step 3: Implement** — `agentOverlayByEntityRefs.ts`

```ts
import { v } from "convex/values"
import { authedQuery } from "../../_lib/authed"

export interface AgentOverlay {
  hasRun: boolean
  status: string
  last_urgency: number | null
  last_chatted_at: number  // run.updated_at — cheapest "last activity" proxy (see spec open-Q #2)
}

export default authedQuery({
  args: { entity_refs: v.array(v.string()) },
  handler: async (ctx, args): Promise<Record<string, AgentOverlay>> => {
    const out: Record<string, AgentOverlay> = {}
    await Promise.all(
      args.entity_refs.map(async (entity_ref) => {
        const run = await ctx.db
          .query("agenticRuns")
          .withIndex("by_entity_ref", (q) => q.eq("entity_ref", entity_ref))
          .unique()
        if (run) {
          out[entity_ref] = {
            hasRun: true,
            status: run.status,
            last_urgency: run.last_urgency ?? null,
            last_chatted_at: run.updated_at,
          }
        }
      }),
    )
    return out
  },
})
```

NOTE on `last_chatted_at`: using `run.updated_at` (spec open-Q #2 — cheapest proxy; promote to a real last-user-message timestamp later if needed). `by_entity_ref` is `.unique()` per ref; O(n) lookups bounded by the list's visible task count (fine at this scale — agenticRuns has the `by_entity_ref` index).

- [ ] **Step 4: Codegen + run** — `bunx convex dev --once` then `bunx vitest run convex/agentic/queries/agentOverlayByEntityRefs.test.ts` → 2/2 pass. `bun run typecheck:convex` clean.

- [ ] **Step 5: Commit**

```
feat(agent): agentOverlayByEntityRefs batch query for the task overlay

Given a set of entity_refs, returns { hasRun, status, last_urgency,
last_chatted_at } per ref (run.updated_at as the last-activity proxy).
Powers agent-mode decoration/sort/filter on the standard task list
without a runs-first query.
```
```bash
/usr/bin/git add -- convex/agentic/queries/agentOverlayByEntityRefs.ts convex/agentic/queries/agentOverlayByEntityRefs.test.ts convex/_generated/
/usr/bin/git commit -F /tmp/task1-msg.txt
```

### Task 2: client overlay types + merge helper

**Files:**
- Create: `app/src/lib/agent/agentOverlay.ts`
- Create: `app/src/lib/agent/agentOverlay.test.ts`

- [ ] **Step 1: Write the failing test** — `agentOverlay.test.ts`

```ts
import { describe, expect, test } from "vitest"
import { mergeAgentOverlay, type AgentOverlay } from "./agentOverlay"

const task = (id: string) => ({ todoist_id: id, content: `T${id}` }) as { todoist_id: string; content: string }

describe("mergeAgentOverlay", () => {
  test("attaches _agent by entity_ref (todoist:task:<id>)", () => {
    const overlay: Record<string, AgentOverlay> = {
      "todoist:task:a": { hasRun: true, status: "awaiting_decision", last_urgency: 0.9, last_chatted_at: 500 },
    }
    const [a, b] = mergeAgentOverlay([task("a"), task("b")], overlay)
    expect(a._agent).toEqual(overlay["todoist:task:a"])
    expect(b._agent).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement** — `agentOverlay.ts`

```ts
export interface AgentOverlay {
  hasRun: boolean
  status: string
  last_urgency: number | null
  last_chatted_at: number
}

export type WithAgent<T> = T & { _agent?: AgentOverlay }

export function mergeAgentOverlay<T extends { todoist_id: string }>(
  tasks: T[],
  overlay: Record<string, AgentOverlay>,
): WithAgent<T>[] {
  return tasks.map((t) => {
    const a = overlay[`todoist:task:${t.todoist_id}`]
    return a ? { ...t, _agent: a } : t
  })
}
```

- [ ] **Step 4: Run, expect pass.** tsc clean.

- [ ] **Step 5: Commit**
```
feat(agent): client agent-overlay types + merge helper

WithAgent<T> + mergeAgentOverlay attach the per-task agent overlay
(hasRun/status/urgency/last_chatted_at) keyed by todoist:task:<id>.
```

---

## Phase 2 — Read-only two-pane agent mode (reuse TaskListView)

### Task 3: `AgentModeLayout` (resizable list | AgentSurface)

**Files:**
- Create: `app/src/components/agent/AgentModeLayout.tsx`
- Create: `app/src/components/agent/AgentModeLayout.test.tsx`

- [ ] **Step 1: Test** — renders children (list) on the left and `AgentSurface` for the selected entity on the right; empty-state when nothing selected.

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"
vi.mock("./AgentSurface", () => ({ AgentSurface: ({ entity_ref }: { entity_ref: string }) => <div data-testid="surface">{entity_ref}</div> }))
import { AgentModeLayout } from "./AgentModeLayout"

describe("AgentModeLayout", () => {
  test("shows AgentSurface for the selected entity_ref", () => {
    render(<AgentModeLayout selectedEntityRef="todoist:task:b"><div>list</div></AgentModeLayout>)
    expect(screen.getByTestId("surface")).toHaveTextContent("todoist:task:b")
    expect(screen.getByText("list")).toBeInTheDocument()
  })
  test("empty state when nothing selected", () => {
    render(<AgentModeLayout selectedEntityRef={null}><div>list</div></AgentModeLayout>)
    expect(screen.queryByTestId("surface")).toBeNull()
    expect(screen.getByText(/Select a task/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement** — wrap the existing pattern from `QueueView` (ResizablePanelGroup `autoSaveId="agent-mode-panels"`, left panel = `children`, right = `AgentComposerProvider` + `AgentSurface` or `QueueEmptyState`). Reuse `@/components/ui/resizable`, `AgentComposerProvider`, `AgentSurface`, `QueueEmptyState`.

```tsx
import { AgentSurface } from "./AgentSurface"
import { QueueEmptyState } from "./QueueEmptyState"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { AgentComposerProvider } from "@/contexts/AgentComposerContext"

export function AgentModeLayout({ selectedEntityRef, children }: { selectedEntityRef: string | null; children: React.ReactNode }) {
  return (
    <ResizablePanelGroup direction="horizontal" autoSaveId="agent-mode-panels" className="h-full">
      <ResizablePanel defaultSize={42} minSize={25} maxSize={65} className="flex flex-col border-r overflow-hidden">
        {children}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={58} className="flex flex-col overflow-hidden">
        <AgentComposerProvider>
          {selectedEntityRef ? <AgentSurface entity_ref={selectedEntityRef} /> : <QueueEmptyState message="Select a task to view its agent thread." />}
        </AgentComposerProvider>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
```

- [ ] **Step 4: Run, expect pass.** tsc clean.
- [ ] **Step 5: Commit** — `feat(agent): AgentModeLayout — resizable list | AgentSurface wrapper`.

### Task 4: `agentMode` in TaskListView (overlay + layout + selection), read-only

**Files:**
- Modify: `app/src/components/TaskListView.tsx`
- Test: `app/src/components/TaskListView.agent.test.tsx` (new)

- [ ] **Step 1: Test** — with `agentMode`, TaskListView merges the overlay query onto tasks, renders inside `AgentModeLayout`, and selecting a task sets the right-pane entity_ref. Mock `convex/react` `useQuery` to return tasks for the items query and an overlay map for `agentOverlayByEntityRefs`; mock `AgentSurface`. Assert a task row renders and the surface follows selection. (Model the mock-by-fn-name approach from `app/test/agent-queue.integration.test.tsx`.)

```tsx
// @vitest-environment jsdom — full test in implementation; asserts:
// 1. tasks render as rows in agent mode
// 2. AgentModeLayout is present (resizable) with no selection initially → empty right pane
// 3. clicking a row → AgentSurface shows that task's todoist:task:<id>
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement** — add `agentMode?: boolean` to `TaskListViewProps`. When set:
  - after fetching `tasks`, compute `entity_refs = tasks.map(t => 'todoist:task:'+t.todoist_id)` and `const overlay = useQuery(api.agentic.queries.agentOverlayByEntityRefs.default, agentMode && tasks ? { entity_refs } : "skip")`; `const decorated = mergeAgentOverlay(tasks ?? [], overlay ?? {})`.
  - hold `const [selected, setSelected] = useState<string | null>(null)` (entity_ref); wrap the `BaseListView` render in `<AgentModeLayout selectedEntityRef={selected}>`; pass an `onTaskClick`/`onSelect` that sets `selected = 'todoist:task:'+todoist_id`.
  - Reuse the existing `focusedEntityId`/selection plumbing — set `selected` from the same click path. Pass `decorated` to BaseListView instead of raw tasks.
  - Standard mode (no `agentMode`): unchanged (no overlay query — `"skip"`, no layout wrapper).

- [ ] **Step 4: Run, expect pass.** Standard-mode TaskListView tests still pass. tsc clean.
- [ ] **Step 5: Commit** — `feat(agent): agentMode on TaskListView — overlay merge + two-pane selection`.

### Task 5: route the agent-queue preset through TaskListView(agentMode)

**Files:**
- Modify: `app/src/components/layout/Layout.tsx` (the `agent-queue` dispatch), `app/src/lib/views/listDefinitions.tsx`, `app/src/lib/views/types.ts`.

- [ ] **Step 1: Test** — Layout renders `TaskListView` (agentMode) for `agent-queue`, not `QueueView`. (Assert via a render test that the agent-mode layout mounts for that query type; or a unit test on the dispatch helper if extracted.)
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** — the agent-queue list definition's `buildQuery` returns `{ type: "inbox" /* or a dedicated has-run task source */, agentMode: true, agentFilter: "has-run", defaultSort: "urgency" }` (add `agentMode?`/`agentFilter?` to the relevant `ListQueryDefinition` variants in types.ts). In Layout, replace the `if (list.query.type === "agent-queue") return <QueueView/>` branch so the agent-queue list flows into `TaskListView` with `agentMode`. NOTE: the task SOURCE for the has-run preset needs "tasks that have runs" — for v1, fetch the candidate task set via the existing `listAwaitingDecision` entity_refs (or a thin `tasksWithRuns` query returning `TodoistTaskWithProject[]`); the overlay then decorates them. Decide the exact source query in this task and document it inline (this is the one place the model needs runs to seed the task set).
- [ ] **Step 4: Run, expect pass.** Browser-smoke `/agent`.
- [ ] **Step 5: Commit** — `feat(agent): agent-queue preset renders via TaskListView agent mode`.

---

## Phase 3 — Agent sorts + filters

### Task 6: urgency + last-chatted sort options

**Files:** Modify `app/src/lib/views/taskConfig.ts` (taskSortOptions).

- [ ] **Step 1: Test** — a `SortOption<WithAgent<TodoistTaskWithProject>>` "urgency" sorts by `_agent.last_urgency` desc, nulls/no-run last; "last-chatted" sorts by `_agent.last_chatted_at` desc. Test the comparators directly with sample objects.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** — add the two SortOptions (reuse the null-safe urgency comparator logic from `listAwaitingDecision`: numbers desc, null/undefined last, tie on `last_chatted_at`). Expose them so TaskListView passes them as additional `sortOptions` only in agent mode.
- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Commit** — `feat(agent): urgency + last-chatted task sort options for agent mode`.

### Task 7: agent filter dimension (status + has-run / no-run)

**Files:** Modify TaskListView (agent mode) + a small `AgentFilterBar` (reuse `QueueFilterBar`'s model + `statusMeta`), `app/src/lib/agent/agentOverlay.ts` (predicate helpers).

- [ ] **Step 1: Test** — a `filterByAgent(tasks, filterKey)` helper: `"all-open"` keeps open statuses, `"closed"`/`checked` per the existing model, a single status keeps that status, `"no-run"` keeps `_agent === undefined`, `"has-run"` keeps `_agent` present. Unit-test the predicate.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** — predicate in `agentOverlay.ts`; render the filter strip (reuse `QueueFilterBar` extended with a `no-run` option, driven by `statusMeta`) in agent mode via the header slot; apply the predicate to `decorated` before passing to BaseListView; persist the filter in the URL (`?status=`, building on the shipped pattern). Default the agent-queue preset to `has-run`.
- [ ] **Step 4: Run, expect pass.** Browser-smoke the filters.
- [ ] **Step 5: Commit** — `feat(agent): agent filter dimension (status + has-run/no-run) in agent mode`.

---

## Phase 4 — Keyboard + toggle + migration

### Task 8: `AgentModeToggle` header control + URL persistence

**Files:** Create `AgentModeToggle.tsx` (+test); modify TaskListView to register it via `useHeaderSlotContent("agent-mode-toggle", ...)` and read/write `?mode=agent`.

- [ ] **Step 1: Test** — toggle renders standard/agent states; clicking emits the mode change; reads initial mode from the URL search.
- [ ] **Step 2–4:** implement (reuse the `?status=`/`?task=` URL pattern; only mount on single-list task views), run, pass.
- [ ] **Step 5: Commit** — `feat(agent): standard/agent mode toggle in the header, persisted in the URL`.

### Task 9: merge keyboard (list nav + agent decision keys)

**Files:** TaskListView (agent mode) wires `useAgentQueueKeybindings` so `j`/`k`/Arrow move the selected row + right pane; the decision keys (`1-4`/`m`/`e`/`esc`) route to the focused `AgentSurface`; standard mode keeps only the existing list shortcuts.

- [ ] **Step 1: Test** — in agent mode, `j` advances the selected entity_ref + the right pane follows; `esc` clears selection. (renderHook/integration as in the queue tests.)
- [ ] **Step 2–4:** implement (selection state already exists from Task 4; bind the hook only when `agentMode`), run, pass.
- [ ] **Step 5: Commit** — `feat(agent): merge queue keyboard into agent-mode TaskListView`.

### Task 10: retire QueueView/QueueRow

**Files:** Delete `app/src/components/agent/QueueView.tsx`, `QueueRow.tsx` (+ tests) once parity is confirmed; remove their imports/dispatch. Keep `AgentSurface`, `AgentModeLayout`, `statusMeta`, `MarkdownLinkText`, `TaskCompleteCircle`, badges, `getQueueEntityMeta`.

- [ ] **Step 1:** grep for `QueueView`/`QueueRow` references; confirm only the (now-replaced) agent-queue dispatch used them.
- [ ] **Step 2:** delete the files + tests; remove references.
- [ ] **Step 3:** Run the full gate — `bun --cwd app tsc --noEmit && bun run typecheck:convex && bunx vitest run` → green (no dangling imports).
- [ ] **Step 4: Manual smoke** — `/agent` (has-run preset) + a normal view toggled into agent mode: rows render with overlay decoration, selection drives the right pane, j/k + decision keys work, filters/sorts work, links + status labels consistent (they already share `MarkdownLinkText`/`statusMeta`).
- [ ] **Step 5: Commit + merge to main** — `refactor(agent): retire QueueView/QueueRow; agent mode is the single interface`.

---

## Self-review checklist (run at plan-write time)

- ✅ Spec "tasks → runs overlay" — Task 1 (query) + Task 2 (merge) + Task 4 (TaskListView uses it).
- ✅ Spec "one interface, two modes" — Task 4 (agentMode) + Task 8 (toggle).
- ✅ Spec "row convergence / reuse TaskListItem" — Task 4 (no new row type; `_agent` overlay; TaskListItem already renders AgentStatusBadge). NOTE: richer per-row decoration (urgency chip / last-chat on the row) can layer onto TaskListItem's badge slots in Task 4/6 — kept minimal to avoid divergence.
- ✅ Spec "no run yet filter" — Task 7.
- ✅ Spec "combined sort" — Task 6.
- ✅ Spec "keyboard merge" — Task 9.
- ✅ Spec "toggle UX + persistence" — Task 8.
- ✅ Spec "agent-queue = has-run preset" — Task 5 + Task 7 default.
- ✅ Spec "retire QueueView/QueueRow" — Task 10.

**Open items deferred to execution (flagged in tasks, per spec open-Qs):**
1. Task 5: the has-run preset's task SOURCE query (seed task set from runs) — pick `tasksWithRuns` query vs reuse `listAwaitingDecision` entity_refs; document inline.
2. Task 1: `last_chatted_at = run.updated_at` proxy; promote to a real last-user-message timestamp if it proves insufficient (spec open-Q #2).
3. Data layer A (overlay query) is implemented; if filtering/sorting agent fields across arbitrary large views gets slow, migrate to denormalized fields on `todoist_items` (spec data-layer option B) — out of scope here.
