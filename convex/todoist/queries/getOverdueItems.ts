import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { Doc } from "../../_generated/dataModel";
import { query } from "../../_generated/server";

export const getOverdueItems = query({
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

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISODate = today.toISOString().split('T')[0];

    const overdueItems: Doc<"todoist_items">[] = allItems.filter((item: Doc<"todoist_items">) => {
      // Exclude routine tasks from time filters
      if (item.labels?.includes("routine")) return false;

      if (!item.due) return false;

      const dueDate = item.due.date;
      if (!dueDate) return false;

      if (dueDate.includes('T')) {
        const dueDateObj = new Date(dueDate);
        return dueDateObj < today;
      } else {
        return dueDate < todayISODate;
      }
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