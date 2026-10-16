import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { Doc } from "../../_generated/dataModel";
import { authedQuery } from "../../_lib/authed";

export const getOverdueItems = authedQuery({
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
    now: v.optional(v.number()),
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

    // timezoneOffsetMinutes: minutes to ADD to UTC to get local time (e.g., PST is -480)
    const nowLocal = new Date((args.now ?? Date.now()) + (args.timezoneOffsetMinutes ?? 0) * 60 * 1000);
    const todayLocalDate = nowLocal.toISOString().split('T')[0];

    const overdueItems: Doc<"todoist_items">[] = allItems.filter((item: Doc<"todoist_items">) => {
      // Exclude routine tasks from time filters
      if (item.labels?.includes("routine")) return false;

      const dueDate = item.due?.date;
      if (!dueDate) return false;

      return dueDate.split('T')[0] < todayLocalDate;
    });

    const sortedItems: Doc<"todoist_items">[] = overdueItems.sort((a: Doc<"todoist_items">, b: Doc<"todoist_items">) => {
      const aDate = a.due?.date ? new Date(a.due.date) : new Date(0);
      const bDate = b.due?.date ? new Date(b.due.date) : new Date(0);
      return aDate.getTime() - bDate.getTime();
    });

    if (args.limit && args.limit > 0) {
      return sortedItems.slice(0, args.limit);
    }

    return sortedItems;
  },
});