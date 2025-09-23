import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { Doc } from "../../_generated/dataModel";
import { query } from "../../_generated/server";
import { applyGlobalFilters } from "../helpers/globalFilters";

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
  },
  handler: async (ctx, args) => {
    const rawItems = await ctx.runQuery(
      internal.todoist.internal.index.getRawActiveItems,
      { projectId: args.projectId }
    );

    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISODate = today.toISOString().split('T')[0];

    const endOfToday = new Date(today);
    endOfToday.setHours(23, 59, 59, 999);

    const dueTodayItems = rawItems.filter((item: Doc<"todoist_items">) => {
      if (!item.due) return false;

      const dueDate = item.due.date;
      if (!dueDate) return false;

      if (dueDate.includes('T')) {
        const dueDateObj = new Date(dueDate);
        return dueDateObj >= today && dueDateObj <= endOfToday;
      } else {
        return dueDate === todayISODate;
      }
    });

    const filteredItems = applyGlobalFilters(dueTodayItems, {
      assigneeFilter: args.assigneeFilter,
      currentUserId: userId,
    });

    const sortedItems = filteredItems.sort((a, b) => {
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