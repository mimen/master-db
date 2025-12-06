import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { Doc } from "../../_generated/dataModel";
import { query } from "../../_generated/server";

export const getNoDueDateItems = query({
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

    const noDueDateItems: Doc<"todoist_items">[] = allItems.filter((item: Doc<"todoist_items">) => {
      // Exclude routine tasks from time filters
      if (item.labels?.includes("routine")) return false;

      return !item.due || !item.due.date;
    });

    const sortedItems: Doc<"todoist_items">[] = noDueDateItems.sort((a: Doc<"todoist_items">, b: Doc<"todoist_items">) => {
      return a.child_order - b.child_order;
    });

    if (args.limit && args.limit > 0) {
      return sortedItems.slice(0, args.limit);
    }

    return sortedItems;
  },
});