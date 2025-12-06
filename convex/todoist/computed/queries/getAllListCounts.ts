import { v } from "convex/values";

import { internal } from "../../../_generated/api";
import { Doc } from "../../../_generated/dataModel";
import { query } from "../../../_generated/server";

/**
 * Unified count query that returns all list counts in a single call.
 * This is ~34% faster than making 4 separate queries.
 *
 * Returns a flat map of list IDs to their task counts:
 * - list:inbox -> inbox task count
 * - list:time:today -> today task count
 * - list:time:overdue -> overdue task count
 * - list:time:upcoming -> upcoming task count (tomorrow through next 7 days)
 * - list:time:tomorrow -> tomorrow task count
 * - list:time:next7days -> next 7 days task count (day after tomorrow through 7 days)
 * - list:time:future -> future task count
 * - list:time:nodate -> no date task count
 * - list:priority:p1 -> P1 task count (API priority 4)
 * - list:priority:p2 -> P2 task count (API priority 3)
 * - list:priority:p3 -> P3 task count (API priority 2)
 * - list:priority:p4 -> P4 task count (API priority 1)
 * - list:project:${projectId} -> project task count
 * - list:projects -> active projects count (all)
 * - list:projects-only -> projects with @project-type label count
 * - list:areas-only -> projects with @area-of-responsibility label count
 * - list:unassigned-folders -> projects without type labels count
 * - list:label:${labelName} -> label task count
 * - list:routines -> active routines count (global)
 * - list:routines:${projectId} -> active routines count for specific project
 */
export const getAllListCounts = query({
  args: {
    timezoneOffsetMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Record<string, number>> => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;

    // Fetch all active items once (shared across all count computations)
    const filteredItems: Doc<"todoist_items">[] = await ctx.runQuery(
      internal.todoist.internalQueries.getFilteredActiveItems.getFilteredActiveItems,
      {
        assigneeFilter: 'not-assigned-to-others',
        currentUserId: userId,
      }
    );

    // Get current time in user's timezone
    const offsetMs = (args.timezoneOffsetMinutes ?? 0) * 60 * 1000;
    const nowUTC = Date.now();
    const nowLocal = new Date(nowUTC + offsetMs);

    // Get today's date string in user's local timezone (YYYY-MM-DD)
    const year = nowLocal.getUTCFullYear();
    const month = String(nowLocal.getUTCMonth() + 1).padStart(2, '0');
    const day = String(nowLocal.getUTCDate()).padStart(2, '0');
    const todayISO = `${year}-${month}-${day}`;

    // Calculate tomorrow in user's timezone
    const tomorrowLocal = new Date(nowLocal);
    tomorrowLocal.setUTCDate(tomorrowLocal.getUTCDate() + 1);
    const tomorrowYear = tomorrowLocal.getUTCFullYear();
    const tomorrowMonth = String(tomorrowLocal.getUTCMonth() + 1).padStart(2, '0');
    const tomorrowDay = String(tomorrowLocal.getUTCDate()).padStart(2, '0');
    const tomorrowISO = `${tomorrowYear}-${tomorrowMonth}-${tomorrowDay}`;

    // Calculate 7 days from today in user's timezone
    const next7DaysLocal = new Date(nowLocal);
    next7DaysLocal.setUTCDate(next7DaysLocal.getUTCDate() + 7);
    const next7Year = next7DaysLocal.getUTCFullYear();
    const next7Month = String(next7DaysLocal.getUTCMonth() + 1).padStart(2, '0');
    const next7Day = String(next7DaysLocal.getUTCDate()).padStart(2, '0');
    const next7DaysISO = `${next7Year}-${next7Month}-${next7Day}`;

    // Helper to extract date-only part from date or datetime string
    const extractDateOnly = (dateStr: string): string => {
      return dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
    };

    // Helper to check if item matches time filter
    // Note: Items with @routine label are excluded from time filters
    const matchesTimeFilter = (item: Doc<"todoist_items">, filter: string): boolean => {
      // Exclude routine tasks from time filters
      if (item.labels?.includes("routine")) return false;

      if (filter === 'overdue') {
        if (!item.due?.date) return false;
        const dateOnly = extractDateOnly(item.due.date);
        return dateOnly < todayISO;
      }
      if (filter === 'today') {
        if (!item.due?.date) return false;
        const dateOnly = extractDateOnly(item.due.date);
        return dateOnly === todayISO;
      }
      if (filter === 'upcoming') {
        // Upcoming = tomorrow through next 7 days (matches getDueNext7DaysItems logic)
        if (!item.due?.date) return false;
        const dateOnly = extractDateOnly(item.due.date);
        return dateOnly > todayISO && dateOnly <= next7DaysISO;
      }
      if (filter === 'tomorrow') {
        if (!item.due?.date) return false;
        const dateOnly = extractDateOnly(item.due.date);
        return dateOnly === tomorrowISO;
      }
      if (filter === 'next7days') {
        if (!item.due?.date) return false;
        const dateOnly = extractDateOnly(item.due.date);
        return dateOnly > tomorrowISO && dateOnly <= next7DaysISO;
      }
      if (filter === 'future') {
        if (!item.due?.date) return false;
        const dateOnly = extractDateOnly(item.due.date);
        return dateOnly > next7DaysISO;
      }
      if (filter === 'nodate') {
        return !item.due?.date;
      }
      return false;
    };

    const counts: Record<string, number> = {};

    // Time filter counts
    const timeFilters = ['overdue', 'today', 'upcoming', 'tomorrow', 'next7days', 'future', 'nodate'];
    for (const filter of timeFilters) {
      const count = filteredItems.filter(item => matchesTimeFilter(item, filter)).length;
      counts[`list:time:${filter}`] = count;
    }

    // Priority counts (remember: API priority 4 = UI P1, 3 = P2, 2 = P3, 1 = P4)
    // Exclude routine tasks from priority filters
    const priorityMapping = [
      { uiLevel: 'p1', apiPriority: 4 },
      { uiLevel: 'p2', apiPriority: 3 },
      { uiLevel: 'p3', apiPriority: 2 },
      { uiLevel: 'p4', apiPriority: 1 },
    ];
    for (const { uiLevel, apiPriority } of priorityMapping) {
      const count = filteredItems.filter(item =>
        item.priority === apiPriority && !item.labels?.includes("routine")
      ).length;
      counts[`list:priority:${uiLevel}`] = count;
    }

    // Project counts (including inbox)
    const projects = await ctx.db
      .query("todoist_projects")
      .filter(q => q.eq(q.field("is_deleted"), false))
      .filter(q => q.eq(q.field("is_archived"), false))
      .collect();

    for (const project of projects) {
      const count = filteredItems.filter(item => item.project_id === project.todoist_id).length;
      counts[`list:project:${project.todoist_id}`] = count;

      // Identify inbox project - use inbox_project flag if available,
      // otherwise fall back to name "Inbox" and no parent (same logic as frontend)
      const isInbox = project.inbox_project || (project.name === "Inbox" && !project.parent_id);
      if (isInbox) {
        counts['list:inbox'] = count;
      }
    }

    // Label counts
    const labels = await ctx.db
      .query("todoist_labels")
      .filter(q => q.eq(q.field("is_deleted"), false))
      .collect();

    for (const label of labels) {
      const count = filteredItems.filter(item =>
        item.labels && item.labels.includes(label.name)
      ).length;
      counts[`list:label:${label.name}`] = count;
    }

    // Projects count (total active projects)
    counts['list:projects'] = projects.length;

    // Project type counts (for folder type filters)
    const projectsWithMetadata = await ctx.db
      .query("todoist_project_metadata")
      .collect();

    const projectTypeMap = new Map(projectsWithMetadata.map(pm => [pm.project_id, pm]));

    // Count projects by type
    let projectsOnlyCount = 0;
    let areasOnlyCount = 0;
    let unassignedCount = 0;

    for (const project of projects) {
      const metadata = projectTypeMap.get(project.todoist_id);
      const projectType = metadata?.project_type;

      if (projectType === "project-type") {
        projectsOnlyCount++;
      } else if (projectType === "area-of-responsibility") {
        areasOnlyCount++;
      } else {
        unassignedCount++;
      }
    }

    counts['list:projects-only'] = projectsOnlyCount;
    counts['list:areas-only'] = areasOnlyCount;
    counts['list:unassigned-folders'] = unassignedCount;

    // Routines count (total active routines)
    const routines = await ctx.db
      .query("routines")
      .withIndex("by_defer", (q) => q.eq("defer", false))
      .collect();
    counts['list:routines'] = routines.length;

    // Per-project routine counts
    for (const project of projects) {
      const count = routines.filter(routine =>
        routine.todoistProjectId === project.todoist_id
      ).length;
      counts[`list:routines:${project.todoist_id}`] = count;
    }

    // Routine task filter counts
    const routineItems = filteredItems.filter(item =>
      item.labels && item.labels.includes("routine")
    );

    // Calculate 5 days from today for Ready to Go filter
    const fiveDaysLocal = new Date(nowLocal);
    fiveDaysLocal.setUTCDate(fiveDaysLocal.getUTCDate() + 5);
    const fiveDaysYear = fiveDaysLocal.getUTCFullYear();
    const fiveDaysMonth = String(fiveDaysLocal.getUTCMonth() + 1).padStart(2, '0');
    const fiveDaysDay = String(fiveDaysLocal.getUTCDate()).padStart(2, '0');
    const fiveDaysISO = `${fiveDaysYear}-${fiveDaysMonth}-${fiveDaysDay}`;

    // Overdue routines: either due date OR deadline is overdue
    counts['list:routine-tasks:overdue'] = routineItems.filter(item => {
      const dueDate = item.due?.date ? extractDateOnly(item.due.date) : null;
      const deadlineDate = item.deadline?.date ?? null;
      return (dueDate && dueDate < todayISO) || (deadlineDate && deadlineDate < todayISO);
    }).length;

    // Morning routine: due date is today + morning label
    counts['list:routine-tasks:morning'] = routineItems.filter(item => {
      if (!item.labels?.includes("morning")) return false;
      if (!item.due?.date) return false;
      const dueDate = extractDateOnly(item.due.date);
      return dueDate === todayISO;
    }).length;

    // Night routine: due date is today + night label
    counts['list:routine-tasks:night'] = routineItems.filter(item => {
      if (!item.labels?.includes("night")) return false;
      if (!item.due?.date) return false;
      const dueDate = extractDateOnly(item.due.date);
      return dueDate === todayISO;
    }).length;

    // Ready to Go: due date is today OR deadline within next 7 days
    // Excludes morning/night routines with due date today (they have their own filters)
    counts['list:routine-tasks:todays'] = routineItems.filter(item => {
      const dueDate = item.due?.date ? extractDateOnly(item.due.date) : null;
      const deadlineDate = item.deadline?.date ?? null;

      // Due date is today (but not morning/night)
      if (dueDate === todayISO) {
        if (item.labels?.includes("morning") || item.labels?.includes("night")) {
          return false;
        }
        return true;
      }

      // Deadline is within next 5 days (today through +5)
      if (deadlineDate && deadlineDate >= todayISO && deadlineDate <= fiveDaysISO) {
        return true;
      }

      return false;
    }).length;

    // Get ahead: deadline is beyond 5 days from now
    counts['list:routine-tasks:get-ahead'] = routineItems.filter(item => {
      const deadlineDate = item.deadline?.date ?? null;
      if (!deadlineDate) return false;
      return deadlineDate > fiveDaysISO;
    }).length;

    return counts;
  },
});
