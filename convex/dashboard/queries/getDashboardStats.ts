import { v } from "convex/values";

import { Doc } from "../../_generated/dataModel";
import { query } from "../../_generated/server";

/**
 * Single aggregate query that produces every value the Dashboard view needs.
 * Composed in one DB pass to avoid client-side fan-out across many smaller
 * queries. All data is sourced from existing Todoist + Routines mirror tables.
 */

export interface DashboardTopProject {
  todoistId: string;
  name: string;
  color: string; // Todoist color name (e.g., "lavender")
  activeTaskCount: number;
  priority: number | null; // Project metadata priority: 4 = P1 (highest), null if unset
  scheduledDate: string | null; // YYYY-MM-DD from project metadata, when the project itself is scheduled
}

export interface DashboardFocusItem {
  todoistId: string;
  content: string;
  priority: number; // Todoist API priority: 4 = P1 (highest)
  projectName: string | null;
  projectColor: string | null; // Todoist color name
  dueDate: string | null; // YYYY-MM-DD if scheduled; null otherwise
  isOverdue: boolean;
}

export interface DashboardPriorityCounts {
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  total: number;
}

export interface DashboardRoutinesSummary {
  active: number;
  paused: number;
  avgCompletion: number; // 0-100, rounded
  overdueRoutineTasks: number;
}

export interface DashboardStats {
  // Row 1
  overdue: number;
  dueToday: number;
  dueThisWeek: number;
  inbox: number;
  p1Active: number;
  // Row 2
  priorityCounts: DashboardPriorityCounts;
  routines: DashboardRoutinesSummary;
  // Row 3
  topProjects: DashboardTopProject[];
  focusQueue: DashboardFocusItem[];
  // Metadata
  generatedAt: number;
}

/**
 * Compute today's ISO date (YYYY-MM-DD) given the caller's timezone offset.
 * Browsers report `Date.prototype.getTimezoneOffset()` in minutes WEST of UTC
 * (positive for PT, negative for east-of-UTC). We mirror that convention.
 */
export function computeDayBoundariesISO(
  timezoneOffsetMinutes: number,
  nowMs: number = Date.now()
): { todayISO: string; sevenDaysISO: string } {
  // Shift the wall-clock instant so its UTC components reflect the user's day.
  const localized = new Date(nowMs - timezoneOffsetMinutes * 60 * 1000);
  const today = new Date(
    Date.UTC(
      localized.getUTCFullYear(),
      localized.getUTCMonth(),
      localized.getUTCDate()
    )
  );
  const sevenDays = new Date(today);
  sevenDays.setUTCDate(today.getUTCDate() + 7);
  return {
    todayISO: today.toISOString().slice(0, 10),
    sevenDaysISO: sevenDays.toISOString().slice(0, 10),
  };
}

/**
 * Extract HH:MM from a due.datetime field, which Todoist may format with or
 * without timezone information. Returns null when the due is all-day or the
 * value isn't a parseable datetime.
 */
export function extractStartTime(
  due: { date: string; datetime?: string } | undefined
): string | null {
  if (!due?.datetime) return null;
  const match = due.datetime.match(/T(\d{2}):(\d{2})/);
  if (!match) return null;
  return `${match[1]}:${match[2]}`;
}

/**
 * Aggregator. Pure function exposed for tests — operates on already-fetched
 * docs rather than re-querying. The Convex handler below fetches once then
 * passes everything in.
 */
export function aggregateDashboardStats(input: {
  items: Doc<"todoist_items">[];
  projects: Doc<"todoist_projects">[];
  routines: Doc<"routines">[];
  projectMetadata: Doc<"todoist_project_metadata">[];
  overdueRoutineTaskCount: number;
  todayISO: string;
  sevenDaysISO: string;
  nowMs: number;
}): DashboardStats {
  const {
    items: rawItems,
    projects,
    routines,
    projectMetadata,
    overdueRoutineTaskCount,
    todayISO,
    sevenDaysISO,
    nowMs,
  } = input;

  // Strip out master-db's internal metadata tasks (content starts with "*").
  // These special tasks encode per-project priority/scheduled-date and aren't
  // real to-do items — including them would inflate every count on the
  // dashboard. The same filter is used by
  // convex/todoist/computed/mutations/extractProjectMetadata.ts.
  const items = rawItems.filter((item) => !item.content.startsWith("*"));

  // Project metadata lookup, keyed by todoist project id.
  const metadataByProject = new Map(
    projectMetadata.map((m) => [m.project_id, m])
  );

  // Match the canonical fallback in
  // convex/todoist/computed/queries/getAllListCounts.ts: the `inbox_project`
  // flag is preferred when present, but Todoist's mirror sometimes leaves it
  // null. Fall back to name + no-parent.
  const inboxProject = projects.find(
    (p) =>
      p.inbox_project === true ||
      (p.name === "Inbox" && !p.parent_id)
  );
  const inboxProjectId = inboxProject?.todoist_id;

  // Row 1 counts.
  let overdue = 0;
  let dueToday = 0;
  let dueThisWeek = 0;
  let inbox = 0;
  let p1Active = 0;
  const priorityCounts: DashboardPriorityCounts = {
    p1: 0,
    p2: 0,
    p3: 0,
    p4: 0,
    total: 0,
  };
  const projectActiveCounts = new Map<string, number>();

  for (const item of items) {
    priorityCounts.total += 1;
    if (item.priority === 4) {
      priorityCounts.p1 += 1;
      p1Active += 1;
    } else if (item.priority === 3) {
      priorityCounts.p2 += 1;
    } else if (item.priority === 2) {
      priorityCounts.p3 += 1;
    } else {
      priorityCounts.p4 += 1;
    }

    if (item.project_id) {
      // Tally per project for the Top Projects card. Inbox excluded so it
      // shows as its own headline card without dominating the leaderboard.
      if (item.project_id !== inboxProjectId) {
        projectActiveCounts.set(
          item.project_id,
          (projectActiveCounts.get(item.project_id) ?? 0) + 1
        );
      }
    }

    if (inboxProjectId && item.project_id === inboxProjectId) {
      inbox += 1;
    }

    const dateOnly = item.due?.date?.includes("T")
      ? item.due.date.split("T")[0]
      : item.due?.date;
    if (dateOnly) {
      if (dateOnly < todayISO) overdue += 1;
      else if (dateOnly === todayISO) dueToday += 1;

      if (dateOnly >= todayISO && dateOnly < sevenDaysISO) {
        dueThisWeek += 1;
      }
    }
  }

  // Top projects: rank by (priority desc, active task count desc). Projects
  // without a metadata priority sort below all priority-set projects. Take
  // top 6 and enrich with display fields. Only include projects that exist
  // in the active project set; tasks pointing at archived/deleted projects
  // are dropped from this card.
  const projectsByTodoistId = new Map(
    projects.map((p) => [p.todoist_id, p])
  );
  const topProjects: DashboardTopProject[] = Array.from(
    projectActiveCounts.entries()
  )
    .map(([projectId, count]) => {
      const project = projectsByTodoistId.get(projectId);
      if (!project) return null;
      const meta = metadataByProject.get(projectId);
      return {
        todoistId: projectId,
        name: project.name,
        color: project.color,
        activeTaskCount: count,
        priority: meta?.priority ?? null,
        scheduledDate: meta?.scheduled_date ?? null,
      };
    })
    .filter((p): p is DashboardTopProject => p !== null)
    .sort((a, b) => {
      // Higher priority first (4 > 3 > 2 > 1 > null).
      const ap = a.priority ?? 0;
      const bp = b.priority ?? 0;
      if (ap !== bp) return bp - ap;
      return b.activeTaskCount - a.activeTaskCount;
    })
    .slice(0, 6);

  // Focus queue: surface what to work on next. Rank by priority (P1 > P2 > P3
  // > P4), tiebreaker by dueness (overdue > today > this week > future > no
  // date). Inbox tasks excluded since the Inbox card already surfaces them.
  function duenessScore(item: Doc<"todoist_items">): number {
    const dateOnly = item.due?.date?.includes("T")
      ? item.due.date.split("T")[0]
      : item.due?.date;
    if (!dateOnly) return 1; // No date
    if (dateOnly < todayISO) return 5; // Overdue
    if (dateOnly === todayISO) return 4; // Today
    if (dateOnly < sevenDaysISO) return 3; // This week
    return 2; // Future
  }
  const focusCandidates = items.filter(
    (item) => item.project_id !== inboxProjectId
  );
  focusCandidates.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    const aDue = duenessScore(a);
    const bDue = duenessScore(b);
    if (aDue !== bDue) return bDue - aDue;
    // Final tiebreaker: earlier due date wins (lexicographic on YYYY-MM-DD).
    const aDate = a.due?.date ?? "9999";
    const bDate = b.due?.date ?? "9999";
    return aDate.localeCompare(bDate);
  });
  const focusQueue: DashboardFocusItem[] = focusCandidates
    .slice(0, 6)
    .map((item) => {
      const project = item.project_id
        ? projectsByTodoistId.get(item.project_id)
        : undefined;
      const dateOnly = item.due?.date?.includes("T")
        ? item.due.date.split("T")[0]
        : item.due?.date ?? null;
      return {
        todoistId: item.todoist_id,
        content: item.content,
        priority: item.priority,
        projectName: project?.name ?? null,
        projectColor: project?.color ?? null,
        dueDate: dateOnly ?? null,
        isOverdue: dateOnly ? dateOnly < todayISO : false,
      };
    });

  // Routines summary.
  const activeRoutines = routines.filter((r) => r.defer === false);
  const pausedRoutines = routines.filter((r) => r.defer === true);
  const rates = activeRoutines
    .map((r) => r.completionRateOverall)
    .filter((r): r is number => r !== null);
  const avgCompletion =
    rates.length > 0
      ? Math.round(rates.reduce((s, r) => s + r, 0) / rates.length)
      : 0;

  return {
    overdue,
    dueToday,
    dueThisWeek,
    inbox,
    p1Active,
    priorityCounts,
    routines: {
      active: activeRoutines.length,
      paused: pausedRoutines.length,
      avgCompletion,
      overdueRoutineTasks: overdueRoutineTaskCount,
    },
    topProjects,
    focusQueue,
    generatedAt: nowMs,
  };
}

export const getDashboardStats = query({
  args: {
    timezoneOffsetMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<DashboardStats> => {
    const nowMs = Date.now();
    const { todayISO, sevenDaysISO } = computeDayBoundariesISO(
      args.timezoneOffsetMinutes ?? 0,
      nowMs
    );

    // Active = not deleted AND not checked. Uses the existing compound index.
    const items: Doc<"todoist_items">[] = await ctx.db
      .query("todoist_items")
      .withIndex("active_items", (q) =>
        q.eq("is_deleted", false).eq("checked", false)
      )
      .collect();

    const projects: Doc<"todoist_projects">[] = await ctx.db
      .query("todoist_projects")
      .withIndex("active_projects", (q) =>
        q.eq("is_deleted", false).eq("is_archived", false)
      )
      .collect();

    const routines: Doc<"routines">[] = await ctx.db
      .query("routines")
      .collect();

    const projectMetadata: Doc<"todoist_project_metadata">[] = await ctx.db
      .query("todoist_project_metadata")
      .collect();

    // Overdue routine tasks: pending status with a dueDate in the past.
    // routineTasks.dueDate is a timestamp (number), not an ISO string.
    const pendingRoutineTasks: Doc<"routineTasks">[] = await ctx.db
      .query("routineTasks")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    const overdueRoutineTaskCount = pendingRoutineTasks.filter(
      (rt) => rt.dueDate < nowMs
    ).length;

    return aggregateDashboardStats({
      items,
      projects,
      routines,
      projectMetadata,
      overdueRoutineTaskCount,
      todayISO,
      sevenDaysISO,
      nowMs,
    });
  },
});
