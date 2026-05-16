# Burndown Queue Design — Phase 2

**Date:** 2026-05-16
**Status:** Draft, approved by Milad in chat 2026-05-16
**Scope:** Phase 2 of the agentic engine UX — a single page that lists every entity awaiting a decision and lets the user plow through them with keyboard + a persistent right pane.

**Companion docs:**
- Phase 1 spec: [`2026-05-15-agentic-engine-ux-design.md`](./2026-05-15-agentic-engine-ux-design.md) — drawer surface this builds on
- Phase 1 plan: [`../plans/2026-05-15-agentic-engine-ux-implementation.md`](../plans/2026-05-15-agentic-engine-ux-implementation.md)
- Urgency note: [`../notes/2026-05-16-urgency-scoring.md`](../notes/2026-05-16-urgency-scoring.md) — coordinated parallel work for the urgency field this view sorts on

## Purpose

The per-entity drawer (Phase 1) is reactive — you have to know to open a task before you see its proposal. Once you have 20–50 entities with pending decisions, you don't want to chase them one at a time. The burndown queue is the daily-driver page: open it, scan the list, decide, move on.

This is where the agentic engine stops being "neat per-task drawer" and becomes "the way you run your day."

## Non-goals (Phase 2)

- Inline option execution without the right pane being open — defer.
- Email / Beeper / other entity types in the queue feed — just `todoist:task` for v1; multi-source is Phase 3+.
- Persistent localStorage of filter/sort preferences — easy follow-up.
- Bulk operations (select multiple, dismiss-all, mark-all-as-not-urgent) — out.
- A `/queue` for the agent's *internal* queue state per-entity. The burndown queue is across entities; the per-entity queue inside the engine is a different concept.

## Architecture

```
Sidebar nav → /agent route → <QueueView>
                              │
                              ├── <QueueFilterBar>   (chips + sort dropdown)
                              ├── <QueueList>        (left pane, scrollable)
                              │     └── <QueueRow>*  (one per matching entity)
                              └── <AgentSurface>     (right pane, focused entity)
                                    │
                                    └── reuses everything that's
                                        currently in <AgentDrawer>'s body:
                                        StatusPill, AgentTranscript,
                                        ThinkingIndicator, AgentComposer
```

**Data:** new Convex query `listAwaitingDecision` reads `agenticRuns` filtered by `status ∈ statuses` (default `["awaiting_decision"]`) and joined to whatever entity-table the row references (Todoist for now) so the row can show the task title/content without N+1 fetches.

**State:** focused entity_ref lives in `QueueView` as `useState<string | null>`. Keyboard handlers update it. `AgentSurface` is just `<AgentSurface entity_ref={focused} />` and gets all reactivity through the existing `useAgentRuntime` hook.

## The `AgentSurface` refactor

Currently the agent UI body lives inside `AgentDrawer.tsx` as the `<AgentDrawerBody>` inner component. It's wrapped in a shadcn `<Sheet>` for the drawer use case.

Extract that body into a standalone `AgentSurface.tsx` component. Same JSX. Same props. The Sheet wrapper stays in `AgentDrawer.tsx`:

```tsx
// AgentDrawer.tsx (after refactor)
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

```tsx
// QueueView.tsx (right pane)
<div className="flex-1 overflow-hidden border-l">
  <AgentComposerProvider>
    {focused ? <AgentSurface entity_ref={focused} /> : <QueueEmptyState />}
  </AgentComposerProvider>
</div>
```

`AgentSurface` keeps the auto-trigger-on-mount logic, the status pill in its own header, the transcript, the thinking indicator, the composer. Drawer and queue share the same code path. Bug fixes to one fix both.

## Visible UX surfaces

### Sidebar entry

New `/agent` entry under existing nav, labeled "Agent queue" with a `Bot` icon. Active state when the route matches. Optional badge showing the count of `awaiting_decision` runs (cheap — same query that drives the page).

### QueueView layout

Two-column split. Desktop (≥640px):

```
┌────────────────────────────────────────────────────────────────┐
│  Filter chips ········ Sort: Urgency ▾    (top bar above list) │
│ ───────────────────────────────────────────────────────────────│
│ ▶ Email Sarah re: venue   Decide   ⚠️ 0.92 │                    │
│   Move Lana to UW26       Decide   · 0.45  │   <AgentSurface   │
│   Draft re-engage email   Decide           │     entity_ref=   │
│   Close stale task        Decide           │     focused />    │
│   …                                        │                    │
└────────────────────────────────────────────────────────────────┘
```

- Left pane: `max-w-[440px]` flex column. Header (filter + sort) sticky. Body scrollable.
- Right pane: `flex-1`. Renders `AgentSurface` for the focused row, or an empty-state when no row is focused.
- Resizable divider: out of scope for v1 (fixed 440px). Easy follow-up.
- Mobile (<640px): stack. Focused row's surface expands below the row inline, like an accordion. No persistent right pane.

### QueueRow

Compact row, hover-highlight, click-focuses. Layout left-to-right:
1. **Source icon** — `<Bot>` for now; future-proofed for Gmail/Beeper icons.
2. **Title** — task `content` truncated to one line.
3. **StatusPill** — same as existing component, e.g. "Decide" amber.
4. **Urgency chip** — when `last_urgency != null`, a tiny pill `0.92` colored by band (≥0.85 rose, 0.5–0.85 amber, <0.5 muted). Hidden when null.
5. **Relative timestamp** — "2h ago" muted, right-aligned.
6. **Focus ring** — when this row is the keyboard-focused one, a left-border accent and a slightly stronger background.

### QueueFilterBar

Above the list:
- **Status chips** (multi-select): `Awaiting decision` (default on) · `Error` · `Thinking` · `Running`. Click toggles. State lives in `QueueView` for now; localStorage persistence is a follow-up.
- **Sort dropdown**: `Urgency` (default) · `Most recent` · `Oldest`. Single-select.

### AgentSurface in the right pane

Same content as the drawer. The component reads its own `useAgentRuntime(entity_ref)` based on the prop; reactivity Just Works as the focused entity changes. The composer's `Modify…` flow still works because it routes through `AgentComposerProvider` mounted in `QueueView`.

### Empty states

- **No entities match the filter:** "Nothing awaiting your decision. Inbox zero." with a small icon. Probably the most satisfying screen in the app.
- **Loading:** skeleton rows.
- **No focused entity (after clearing focus with `esc`):** right pane shows "Select a task to view" placeholder.

## Keyboard model

Bound on the `QueueView` root only when it has focus (route is `/agent`):

| Key | Action |
|---|---|
| `j` / `↓` | Focus next row |
| `k` / `↑` | Focus previous row |
| `1` `2` `3` `4` | Execute Nth option of focused row's proposal (same as clicking `Execute` in the right pane) |
| `e` | Execute recommended option of focused row (synonym of whichever number is the recommended one) |
| `m` | Focus composer in modify-mode for focused row's recommended option |
| `esc` | If composer focused: blur. Else: clear focused row. |
| `/` | Focus the filter bar (future — out of scope v1, just don't bind it) |

Implementation: `useAgentQueueKeybindings` hook, follows the same isTypingTarget guard as the existing `useAgentKeybindings`.

## Data flow

### `convex/agentic/queries/listAwaitingDecision.ts`

```ts
import { v } from "convex/values"
import { authedQuery } from "../../_lib/authed"

export default authedQuery({
  args: {
    statuses: v.optional(v.array(v.string())),  // default: ["awaiting_decision"]
    sort: v.optional(v.string()),               // "urgency" | "recent" | "oldest"
    limit: v.optional(v.number()),              // default 200
  },
  handler: async (ctx, args) => {
    const statuses = args.statuses ?? ["awaiting_decision"]
    const limit = Math.min(args.limit ?? 200, 500)

    // Pull rows. With multiple statuses we collect per status and union;
    // the by_status_and_updated_at index handles single-status efficiently.
    const rows = []
    for (const status of statuses) {
      const slice = await ctx.db
        .query("agenticRuns")
        .withIndex("by_status_and_updated_at", q => q.eq("status", status))
        .order("desc")
        .take(limit)
      rows.push(...slice)
    }

    // Join entity content. For todoist:task: refs we hit todoist_items.
    // Other entity types (gmail_thread etc.) handled in later phases.
    const enriched = await Promise.all(rows.map(async (run) => {
      if (run.entity_type === "todoist_task") {
        const task = await ctx.db
          .query("todoist_items")
          .withIndex("by_todoist_id", q => q.eq("todoist_id", run.entity_id))
          .unique()
        return {
          ...run,
          entity_title: task?.content ?? "(missing)",
          entity_url: null,
        }
      }
      return { ...run, entity_title: run.entity_ref, entity_url: null }
    }))

    // Sort. Urgency uses last_urgency desc (nulls last); ties break on
    // updated_at desc.
    const sort = args.sort ?? "urgency"
    const sorted = enriched.sort((a, b) => {
      if (sort === "oldest") return a.updated_at - b.updated_at
      if (sort === "recent") return b.updated_at - a.updated_at
      // urgency desc, nulls last, then updated_at desc
      const au = (a as { last_urgency?: number | null }).last_urgency
      const bu = (b as { last_urgency?: number | null }).last_urgency
      if (au == null && bu == null) return b.updated_at - a.updated_at
      if (au == null) return 1
      if (bu == null) return -1
      if (au !== bu) return bu - au
      return b.updated_at - a.updated_at
    })

    return sorted.slice(0, limit)
  },
})
```

NOTE: `last_urgency` is added by the parallel urgency-scoring work. If that field isn't on `agenticRuns` yet when this query lands, the sort function gracefully falls through to `updated_at`. Once the urgency PR merges, no code change here needed — the sort already handles both cases.

Also NOTE: the `by_todoist_id` index assumption — verify against the actual `convex/schema/todoist/...` schema. If the index name differs, adjust. The pattern is the same regardless.

### Reactivity

The query is reactive: when a row's `status` changes (a new run starts, a proposal lands, the user executes), the queue re-renders. `useQuery` in `QueueView` returns the new list.

For very large queues, we'd paginate. v1 caps at 200; that's plenty for the foreseeable.

## File layout

**New:**
```
convex/agentic/queries/
  listAwaitingDecision.ts
  listAwaitingDecision.test.ts

app/src/components/agent/
  AgentSurface.tsx           ← extracted from AgentDrawer body
  AgentSurface.test.tsx
  QueueView.tsx              ← orchestrator: state, layout, keyboard host
  QueueView.test.tsx
  QueueRow.tsx
  QueueRow.test.tsx
  QueueFilterBar.tsx
  QueueEmptyState.tsx        ← reused for no-matches / no-focus states

app/src/hooks/
  useAgentQueueKeybindings.ts
  useAgentQueueKeybindings.test.tsx
```

**Modified:**
```
app/src/components/agent/AgentDrawer.tsx   ← slim down to wrap AgentSurface
app/src/App.tsx                             ← add /agent route
app/src/components/layout/Sidebar/<...>    ← add sidebar entry
```

`AgentDrawer.test.tsx` may need test adjustments since the body extracted out, but the test surface (the click → drawer opens → renders) should still pass.

## Reserved seams (Phase 2 leaves room for)

1. **Email / Beeper / etc. entity types** in the queue. The query already branches on `entity_type`; adding a new type is one `if (run.entity_type === "gmail_thread")` block.
2. **Per-source icons** in `QueueRow`. Currently always Bot; later we render a Gmail / Beeper / Todoist icon depending on `entity_type`.
3. **Resizable divider** between panes. Add `<ResizablePanel>` later — shadcn has it.
4. **Persistent filter/sort preferences** — write `localStorage["queue:filters"]` and `localStorage["queue:sort"]` on change. ~10 lines.
5. **Sidebar count badge** — once Phase 3 notification work lands, the count drives the unread/Slack/iOS push triggers.

## Coordination with the urgency PR (parallel work)

The urgency-scoring PR is in flight in another agent. Files they own (don't touch in this PR):

- `engine/src/runner/proposalSchema.ts`
- `engine/src/runner/claudeSdkRunner.ts`
- `convex/schema/agentic/agenticRuns.ts`
- `convex/agentic/mutations/appendThreadMessage.ts` (or wherever proposal writes land)
- `app/src/components/agent/ProposalCard.tsx`
- `app/src/components/badges/shared/AgentStatusBadge.tsx`
- `app/src/lib/agent/proposalToParts.ts`

This PR's `listAwaitingDecision` query references `last_urgency`. The query's sort function is null-safe so it works whether or not that field exists yet. Merge order doesn't matter; whichever lands first works, and the second one merges cleanly.

## Tests

- **Convex query:** exhaustive sort cases (urgency desc with mixed nulls, recent, oldest, multi-status union, limit clamp).
- **QueueRow:** renders content + status pill + urgency chip when present; doesn't render urgency when null; click fires `onFocus` with the entity_ref.
- **QueueFilterBar:** chip toggles emit the new state; sort dropdown emits the new sort.
- **useAgentQueueKeybindings:** all six bindings (`j`/`k`/`1`/`m`/`e`/`esc`) fire the right callbacks; typing-target guard suppresses when an input is focused; not enabled when prop is false.
- **AgentSurface:** rendering parity with the pre-extract behavior — auto-trigger fires once per entity_ref, transcript renders, composer mounts.
- **Integration:** mount `<QueueView>` against a seeded Convex with three awaiting_decision entities; focus the second via `j`; assert right pane shows that entity's transcript; press `1`; assert `postRun` was called with `"EXECUTE: <recommended_id>"`.

## Validation gate per commit

`bun --cwd app tsc --noEmit && bun run lint && npx vitest run`. No new errors in files I touch.

## Open questions / parking lot

1. **Mobile keyboard nav.** Phones don't have `j` / `k`. Mobile UX punts to touch-only — tap row to focus, tap row's options to execute. Not great. Phase 3 polish.
2. **Sidebar count badge real-time accuracy.** Convex reactivity makes this cheap, but in long-lived sessions we should verify it doesn't drift.
3. **Cross-entity decisions.** Some decisions implicate multiple entities (e.g. "move task A and update related task B"). v1 treats each entity independently. Open question what UX cross-entity coordination should look like — out of scope.
4. **History view.** Once a decision is executed, the entity exits the queue. There's no "show me my last 20 executed decisions" view yet. Defer.
