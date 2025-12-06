import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { Doc } from "../../_generated/dataModel";
import { query } from "../../_generated/server";

export const getDueNext7DaysItems = query({
  args: {
    projectId: v.optional(v.string()),
    limit: v.optional(v.number()),
    assigneeFilter: v.optional(
      v.union(
        v.literal('all'),
        v.literal('unassigned'),
        v.literal('assigned-to-me'),
        v.literal('assigned-to-others'),
        v.literal('not-assigned-to-others')
      )
    ),
    timezoneOffsetMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Doc<"todoist_items">[]> => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;

    const allItems: Doc<"todoist_items">[] = await ctx.runQuery(
      internal.todoist.internalQueries.getFilteredActiveItems.getFilteredActiveItems,
      {
        projectId: args.projectId,
        assigneeFilter: args.assigneeFilter,
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
    const todayLocalDate = `${year}-${month}-${day}`;

    // Calculate 7 days from today in user's timezone
    const next7DaysLocal = new Date(nowLocal);
    next7DaysLocal.setUTCDate(next7DaysLocal.getUTCDate() + 7);
    const next7Year = next7DaysLocal.getUTCFullYear();
    const next7Month = String(next7DaysLocal.getUTCMonth() + 1).padStart(2, '0');
    const next7Day = String(next7DaysLocal.getUTCDate()).padStart(2, '0');
    const next7DaysLocalDate = `${next7Year}-${next7Month}-${next7Day}`;

    const dueNext7DaysItems: Doc<"todoist_items">[] = allItems.filter((item: Doc<"todoist_items">) => {
      // Exclude routine tasks from time filters
      if (item.labels?.includes("routine")) return false;

      if (!item.due) return false;

      const dueDate = item.due.date;
      if (!dueDate) return false;

      // Extract date-only part for consistent comparison
      const dateOnly = dueDate.includes('T') ? dueDate.split('T')[0] : dueDate;

      // Upcoming means tomorrow through next 7 days (excluding today)
      return dateOnly > todayLocalDate && dateOnly <= next7DaysLocalDate;
    });

    const sortedItems: Doc<"todoist_items">[] = dueNext7DaysItems.sort((a: Doc<"todoist_items">, b: Doc<"todoist_items">) => {
      const aDate = a.due?.date ? new Date(a.due.date) : new Date(0);
      const bDate = b.due?.date ? new Date(b.due.date) : new Date(0);
      const dateComparison = aDate.getTime() - bDate.getTime();

      if (dateComparison !== 0) return dateComparison;

      if (a.due?.datetime && b.due?.datetime) {
        return new Date(a.due.datetime).getTime() - new Date(b.due.datetime).getTime();
      }
      return a.child_order - b.child_order;
    });

    if (args.limit && args.limit > 0) {
      return sortedItems.slice(0, args.limit);
    }

    return sortedItems;
  },
});