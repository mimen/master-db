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
  color: string;
  activeTaskCount: number;
}

export interface DashboardTodayQueueItem {
  todoistId: string;
  content: string;
  priority: number; // Todoist API priority: 4 = P1 (highest)
  startTime: string | null; // "HH:MM" if the due has a datetime; null for all-day
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
  todayQueue: DashboardTodayQueueItem[];
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
  overdueRoutineTaskCount: number;
  todayISO: string;
  sevenDaysISO: string;
  nowMs: number;
}): DashboardStats {
  const {
    items,
    projects,
    routines,
    overdueRoutineTaskCount,
    todayISO,
    sevenDaysISO,
    nowMs,
  } = input;

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

  // Top projects: sort by active task count descending, take top 6, attach
  // display fields.
  const projectsByTodoistId = new Map(
    projects.map((p) => [p.todoist_id, p])
  );
  const topProjects: DashboardTopProject[] = Array.from(
    projectActiveCounts.entries()
  )
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6)
    .map(([projectId, count]) => {
      const project = projectsByTodoistId.get(projectId);
      return {
        todoistId: projectId,
        name: project?.name ?? "Unknown",
        color: project?.color ?? "grey",
        activeTaskCount: count,
      };
    });

  // Today's queue: tasks due today, sorted by start time when present (timed
  // items first, in order), then untimed items by content.
  const todayItems = items.filter((item) => {
    const dateOnly = item.due?.date?.includes("T")
      ? item.due.date.split("T")[0]
      : item.due?.date;
    return dateOnly === todayISO;
  });
  todayItems.sort((a, b) => {
    const at = extractStartTime(a.due);
    const bt = extractStartTime(b.due);
    if (at && bt) return at.localeCompare(bt);
    if (at) return -1;
    if (bt) return 1;
    return a.content.localeCompare(b.content);
  });
  const todayQueue: DashboardTodayQueueItem[] = todayItems
    .slice(0, 6)
    .map((item) => ({
      todoistId: item.todoist_id,
      content: item.content,
      priority: item.priority,
      startTime: extractStartTime(item.due),
    }));

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
    todayQueue,
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
      overdueRoutineTaskCount,
      todayISO,
      sevenDaysISO,
      nowMs,
    });
  },
});
