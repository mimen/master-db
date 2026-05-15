# Dashboard View — Design Spec

**Status:** approved for implementation
**Date:** 2026-05-15
**Scope:** V1 — Todoist + Routines stats only. External APIs (email, Beeper, calendar, Spotify) deferred to later iterations.

---

## Goal

A polished, single-page "operating view" inside master-db that shows high-level stats at a glance. Same shape as a real product dashboard: stat cards, distribution chart, leaderboard, today's queue. All data sourced from master-db's existing Convex tables (`todoist.items`, `routines.routines`, etc.). No new measurements infrastructure, no new external API calls.

Adding external metric sources later (email unarchived, Beeper unread, etc.) is a separate phase; the dashboard will absorb them as new widgets when their data lands.

---

## Architecture

- **No new tables.** All widgets derive from existing Convex queries against `todoist.*` and `routines.*` mirrors.
- **One new Convex query module:** `convex/dashboard/queries/getDashboardStats.ts` returns a single shape with everything the dashboard view needs. Composes existing per-domain queries internally to avoid N+1 round-trips from the client.
- **One new view:** `view:dashboard` following the 10-step add-views process. Custom query type `"dashboard"`. Custom `DashboardView` component. Reuses existing shadcn components (Card, Badge, Skeleton, Separator).
- **Sidebar entry** near the top of the sidebar, prominent. No breach badge for V1 (no SLAs yet — that comes when we add external sources with thresholds).
- **No URL params, no list interactivity** in V1. The dashboard is read-only display; clicking a widget could navigate to the underlying view (e.g., click "Overdue" → `view:time:overdue`), but that's a nice-to-have, not core.

---

## Widget set (V1)

Seven widgets in three rows:

### Row 1 — Headline counts (5 stat cards)

| Widget | Value | Existing query / table | Notes |
|---|---|---|---|
| Overdue | count of active tasks where `due.date < today` | composes `getOverdueItems` or filter on `getActiveItems` | red-tinted if > 0 |
| Due today | count where `due.date == today` | `getDueTodayItems` | neutral |
| Due this week | count where `due.date <= today + 7d` | `getDueNext7DaysItems` | neutral |
| Inbox | count in Todoist Inbox project | composes inbox project query | neutral |
| P1 active | count where `priority == 4 && !completed` | filter on `getActiveItems` | red-tinted if > 0 |

Each card: small label, large number (tabular-nums), optional one-line sub-detail.

### Row 2 — Distribution + Routines (2 cards)

- **Priority distribution.** Bar visualization of P1 / P2 / P3 / P4 counts across active tasks. Color-coded by priority (P1 red, P2 orange, P3 blue, P4 muted). Total task count subtitle.
- **Routines health.** Active routines count + paused count, avg completion %, count of overdue routines. From `routines.routines` table.

### Row 3 — Leaderboard + Today's queue (2 cards)

- **Top projects.** Top 6 Todoist projects ranked by active task count. Project name + count. Uses `getProjects` joined with active-task counts.
- **Today's queue.** Today's tasks with start time (if any), task content, priority badge. Up to 6 entries. Uses `getDueTodayItems`.

---

## Backend: new Convex query

**File:** `convex/dashboard/queries/getDashboardStats.ts`

Returns one shape:

```typescript
type DashboardStats = {
  // Row 1
  overdue: number
  dueToday: number
  dueThisWeek: number
  inbox: number
  p1Active: number
  // Row 1 detail sub-strings
  overdueProjectBreakdown: { project: string; count: number }[] // top 2-3
  todayNotStarted: number // optional, may drop
  p1StaleCount: number // P1s with no recent activity > 7d
  // Row 2
  priorityCounts: { p1: number; p2: number; p3: number; p4: number; total: number }
  routines: {
    active: number
    paused: number
    avgCompletion: number // 0-100
    overdueRoutineTasks: number
  }
  // Row 3
  topProjects: { id: string; name: string; activeTaskCount: number }[] // top 6
  todayQueue: { id: string; content: string; priority: number; startTime: string | null }[] // up to 6
}
```

Composes existing queries inside the handler. Single function, single query call from the client. Each contributing source filter is a small helper.

**Per master-db convention:** also create `getDashboardStats.test.ts` with business-logic tests (priority-counts computation, top-N selection, overdue filter).

---

## Frontend: new view

Follows the 10-step add-views process from `docs/adding-views-guide.md`. Specifics:

1. **ViewKey type** — add `"view:dashboard"` to `app/src/lib/views/types.ts`.
2. **List definition** — add `dashboard` to `app/src/lib/views/listDefinitions.tsx`. Header title "Dashboard", icon `LayoutDashboard` from lucide-react. Single-list view.
3. **View registry** — add a pattern matcher in `viewRegistry.tsx`.
4. **Sidebar nav** — add `viewKey: "view:dashboard"` to `buildViewItems()` in `Sidebar/utils/viewItems.ts`. Place above Inbox. No count badge.
5. **URL routing** — `view:dashboard` ↔ `/dashboard`.
6. **Count logic** — N/A (no badge).
7. **DashboardView component** — new `app/src/components/DashboardView.tsx`. Uses `useQuery(api.dashboard.queries.getDashboardStats.getDashboardStats)`. Renders three rows of shadcn cards.
8. **Layout rendering** — add `list.query.type === "dashboard"` branch in `Layout.tsx`.
9. **Query type** — add `{ type: "dashboard" }` to `ListQueryDefinition`.
10. **Icon** — `LayoutDashboard` in `viewIcons.tsx`.

---

## Visual style

- **Dark theme native to master-db.** No new CSS theme. Reuse existing `Card`, `Badge`, `Separator`.
- **Numbers:** large, `font-variant-numeric: tabular-nums`, accent color for breach (red).
- **Stat cards:** padding ~14-16px, border on `border-border`, hover state lifts subtly.
- **Priority bars:** keep simple — flexbox columns, height proportional, color by priority. No chart library.
- **Skeleton states** while `useQuery` is loading — use existing `<Skeleton />` component.
- **Empty states** matter: "No overdue tasks" should celebrate, not feel empty. Subtle.

---

## Out of scope (V1)

- External API integrations (email, Beeper, calendar, Spotify, YNAB, Airtable, Slack). Each becomes a follow-up phase.
- Time-series / sparklines. We don't have measurement history yet. Add when `measurements` table + recorder lands.
- Breach SLAs + thresholds. No alerts in V1.
- Clickable widgets that navigate to underlying views. Nice but not core; add after V1 lands.
- Customizable widget order / hide-toggle.
- Mobile / responsive tuning beyond what shadcn defaults give us.

---

## Implementation order

1. Add Convex query `getDashboardStats` with a test file. Run `bun run typecheck && bun run lint && bun test` — must be green.
2. Reload Convex dev server so the new function is registered.
3. Verify the query works via `bunx convex run dashboard:queries.getDashboardStats.getDashboardStats`.
4. Add ViewKey + List definition + query type + view registry pattern + icon + URL routing. Verify typecheck.
5. Create `DashboardView.tsx` component (rendering only — start with hardcoded fake data to validate layout).
6. Wire to live query data.
7. Add sidebar item. Verify view renders.
8. Polish: skeleton states, empty states, spacing.
9. Final validation: `bun run typecheck && bun run lint && bun test`.
10. Manual QA in browser.

---

## Risks / open questions

- **Priority count semantics.** Todoist's API priority 4 = UI P1 (highest). Master-db has `app/src/lib/priorities.ts` for this; the new query must use that abstraction, not raw numbers.
- **"Today" timezone handling.** Master-db passes `timezoneOffsetMinutes` to time-based queries. The dashboard query needs the same.
- **Routines `avgCompletion` semantics.** Need to read `routines.queries` to confirm what "completion %" means in this codebase before computing it.
- **Test coverage requirement.** Master-db CLAUDE.md says "every query needs a `.test.ts` file." Honor that — at minimum stub one test that validates the shape, plus a real test for any non-trivial logic (priority-distribution, top-N ranking, P1-stale filter).
- **`p1StaleCount` may need touched-at data.** If Todoist mirror doesn't track last activity per task, this metric is undeliverable in V1. Drop or compute approximately (e.g., `priority==4 && due is null && added > 7 days ago`).

---

## Approval

Verbally approved by Milad on 2026-05-15. Proceeding to implementation immediately after this spec is written and self-reviewed.
