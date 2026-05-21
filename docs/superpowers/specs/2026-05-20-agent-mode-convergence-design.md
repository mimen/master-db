# Agent Mode Convergence — Design Spec

**Status:** Draft for review (not yet a plan)
**Date:** 2026-05-20
**Builds on:** the shipped burndown queue (`2026-05-16-burndown-queue-design.md`) — now on `origin/main`.

## Purpose

Stop maintaining two parallel task UIs. Today there are:
- **Standard task list** — `TaskListView` → `TaskListItem` (full badges, hidden-badge logic, property dialogs/overlays, optimistic updates, keyboard).
- **Agent queue** — `QueueView` → `QueueRow` (a separate, slimmer, read-only row + a right-pane `AgentSurface`), driven by an `agenticRuns`-first query.

These have drifted (links, status labels, date chips — all patched after the fact). The goal: **one interface** that can render any single-list task view in either **standard mode** (the list as today) or **agent mode** (the same list + a persistent `AgentSurface` right pane and agent-specific decoration/filters/sorts). The standalone "agent queue" stops being a separate screen and becomes one **filter preset**: *tasks that have an agentic run*, viewed in agent mode, sorted by urgency.

**North star:** maximal reuse, minimal divergence. Agent mode is a *decoration + layout* on the existing list, not a second list.

## The model: tasks → runs (overlay)

The data flows **tasks → runs**, not runs → tasks:
- The list's task set always comes from the **view's existing task query** (project, inbox, label, filter, …) — unchanged from standard mode.
- Each task is **overlaid** with its agent metadata: does a run exist (`hasRun`), `status`, `last_urgency`, `last_chatted_at`.
- The **agent queue** = the same machinery with the task filter set to `hasRun = true`, `mode = agent`, `sort = urgency`. No special view.

This is what makes the toggle truly 1:1 and unlocks, for free: the "no run yet" filter (`hasRun = false`), combined sorting (task fields + agent fields), and rendering the *same* `TaskListItem` in both modes.

## Architecture

### 1. Data layer — agent overlay
The view's task query stays the source of truth for *which* tasks show. Agent metadata is overlaid. Two implementation options (decision needed):

- **(A) Overlay query + client merge (recommended first step):** a new query `agentMetaByEntityRefs(entity_refs[]) → Record<entity_ref, { hasRun, status, last_urgency, last_chatted_at }>`. `TaskListView` (in agent mode) calls it with the visible task ids and merges. The existing task queries are untouched. Filtering by `hasRun` for the agent-queue preset still needs a runs-first source for *that preset only* (or a denormalized flag — see B).
- **(B) Denormalize agent fields onto `todoist_items`** (`agent_status`, `last_urgency`, `last_chatted_at`, updated when runs change): lets the standard task-filter/index path handle `hasRun`/agent-status filtering and sorting natively, no special-case query. More plumbing (write path in the engine/mutations), best long-term for filtering/sorting at scale.

Recommendation: start with **(A)** for the overlay + a runs-first source for the `hasRun` preset; move to **(B)** if filtering/sorting on agent fields needs to be first-class across arbitrary views.

`last_chatted_at` is new metadata — derive from the latest user message in `agenticThreadMessages` for the entity (or `run.updated_at` as a cheaper proxy). Decide during planning.

### 2. Row convergence — one row component
Agent mode renders **`TaskListItem`** (all badges, dialogs, edit affordances, hidden-badge logic) plus a thin **agent decoration**: the `StatusPill` (via `statusMeta`), the urgency chip, and `last_chatted_at`. Add to `TaskListItem`/`BaseListItem`:
- an optional `agentDecoration` slot/prop (rendered when in agent mode),
- a `selected` visual state (the focused row in the two-pane layout),
- an `onSelect(entity_ref)` callback (opens the right pane).

`QueueRow` is **retired** — its content is the decoration on `TaskListItem`. `AgentSurface`, `statusMeta`, `MarkdownLinkText`, `TaskCompleteCircle`, and the shared badges are already shared; this finishes the job.

### 3. The toggle
A standard/agent switch in the header (the existing `HeaderSlotOutlet` "view-settings"/"header-action" slot in `Layout.tsx`), shown only on **single-list task views**. Persists in the URL (`?mode=agent`), building on the `?status=`/`?task=` state from the shipped F5 work.
- **Standard mode:** `TaskListView` as today.
- **Agent mode:** a `ResizablePanelGroup` — left = the same `TaskListView` list (rows decorated, selectable) + agent filter/sort additions; right = `AgentSurface` for the selected task.

### 4. Filters & sorts (combined)
- **Filters:** the view's existing filters **plus** an agent dimension — run status (`statusMeta` keys) and **has-run / no-run-yet**. The 4 status chips + All-open/Closed from the shipped queue become this agent filter dimension, reusing `QueueFilterBar`'s model (likely folded into the standard filter UI in agent mode).
- **Sorts:** the standard sort options **plus** urgency and last-chatted, over one list. Extend the existing `sortAndGroup` / sort registry with the agent comparators (the null-safe urgency comparator already exists in `listAwaitingDecision`).

### 5. Keyboard
Merge the list's existing interactions with the agent decision keys (`j`/`k` navigate the list + move the right-pane selection; the decision keys from `useAgentQueueKeybindings`). Reconcile the two keyboard hooks so agent mode has both; standard mode keeps only the list's.

### 6. Migration of `/agent`
- Redefine the `agent-queue` view as the preset: task filter `hasRun = true`, `mode = agent`, default sort `urgency` — rendered by the converged `TaskListView`, not `QueueView`.
- Retire `QueueView` + `QueueRow` once `TaskListView` + agent mode reaches parity (right pane, decoration, filters, sorts, keyboard, URL state).
- Keep: `AgentSurface`, `statusMeta`, `MarkdownLinkText`, `TaskCompleteCircle`, `DateBadge`/`LabelBadge`/`ProjectBadge`/`PriorityBadge`, the `?status=`/`?task=` URL state, the resizable layout.

## Reuse inventory (already shared — don't rebuild)
`AgentSurface`, `getQueueEntityMeta`/`_enrichQueueRun`, `statusMeta`, `MarkdownLinkText`, `TaskCompleteCircle`, the shared badges, `formatSmartDate`, `getProjectColor`, `usePriority`, the resizable panels, the URL-state pattern.

## Open questions / decisions for planning
1. **Data layer A vs B** (overlay query + client merge now, vs denormalize agent fields onto tasks). Drives how `hasRun`/agent-status filtering + sorting work across arbitrary views.
2. **`last_chatted_at` source** — last user message vs `run.updated_at`.
3. **`TaskListItem` decoration shape** — slot/prop vs a thin wrapper component; how invasive on `BaseListItem`.
4. **Filter UI in agent mode** — fold the agent status/has-run dimension into the standard filter controls, or keep the `QueueFilterBar`-style strip.
5. **Keyboard reconciliation** — one merged hook vs composing the two.
6. **Toggle persistence scope** — per-view memory vs URL only vs a global default.

## Reserved seams (later)
- Multi-source entities (Gmail/Beeper threads) in agent mode — the overlay keys on `entity_ref`, already generic.
- Sidebar count badges for agent statuses.
- Bulk actions across selected agent rows.

## Non-goals
- Multi-list (grouped) views in agent mode — single-list only for v1, per the 1:1 framing.
- Changing standard mode's behavior — it stays exactly as today.
