import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { Doc } from "../../_generated/dataModel";
import { query } from "../../_generated/server";

export const getDueTodayItems = query({
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
    // timezoneOffsetMinutes: minutes to ADD to UTC to get local time (e.g., PST is -480)
    const offsetMs = (args.timezoneOffsetMinutes ?? 0) * 60 * 1000;
    const nowUTC = Date.now();
    const nowLocal = new Date(nowUTC + offsetMs);

    // Get today's date string in user's local timezone (YYYY-MM-DD)
    const year = nowLocal.getUTCFullYear();
    const month = String(nowLocal.getUTCMonth() + 1).padStart(2, '0');
    const day = String(nowLocal.getUTCDate()).padStart(2, '0');
    const todayLocalDate = `${year}-${month}-${day}`;

    // Calculate today's boundaries in user's timezone
    const todayLocal = new Date(Date.UTC(year, nowLocal.getUTCMonth(), nowLocal.getUTCDate(), 0, 0, 0, 0));
    const endOfTodayLocal = new Date(Date.UTC(year, nowLocal.getUTCMonth(), nowLocal.getUTCDate(), 23, 59, 59, 999));

    // Convert back to actual UTC for datetime comparisons
    const todayUTC = new Date(todayLocal.getTime() - offsetMs);
    const endOfTodayUTC = new Date(endOfTodayLocal.getTime() - offsetMs);

    const dueTodayItems: Doc<"todoist_items">[] = allItems.filter((item: Doc<"todoist_items">) => {
      // Exclude routine tasks from time filters
      if (item.labels?.includes("routine")) return false;

      if (!item.due) return false;

      const dueDate = item.due.date;
      if (!dueDate) return false;

      if (dueDate.includes('T')) {
        // For datetime strings, compare in UTC
        const dueDateObj = new Date(dueDate);
        return dueDateObj >= todayUTC && dueDateObj <= endOfTodayUTC;
      } else {
        // For date-only strings, compare with local date
        return dueDate === todayLocalDate;
      }
    });

    const sortedItems: Doc<"todoist_items">[] = dueTodayItems.sort((a: Doc<"todoist_items">, b: Doc<"todoist_items">) => {
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