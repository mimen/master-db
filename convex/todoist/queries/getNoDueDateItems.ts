import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { Doc } from "../../_generated/dataModel";
import { query } from "../../_generated/server";
import { applyGlobalFilters } from "../helpers/globalFilters";

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
  handler: async (ctx, args) => {
    const rawItems = await ctx.runQuery(
      internal.todoist.internal.index.getRawActiveItems,
      { projectId: args.projectId }
    );

    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;

    const noDueDateItems = rawItems.filter((item: Doc<"todoist_items">) => {
      return !item.due || !item.due.date;
    });

    const filteredItems = applyGlobalFilters(noDueDateItems, {
      assigneeFilter: args.assigneeFilter,
      currentUserId: userId,
    });

    const sortedItems = filteredItems.sort((a, b) => {
      return a.child_order - b.child_order;
    });

    if (args.limit && args.limit > 0) {
      return sortedItems.slice(0, args.limit);
    }

    return sortedItems;
  },
});