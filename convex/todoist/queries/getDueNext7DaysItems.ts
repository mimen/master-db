import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { Doc } from "../../_generated/dataModel";
import { query } from "../../_generated/server";
import { applyGlobalFilters } from "../helpers/globalFilters";

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

    const next7Days = new Date(today);
    next7Days.setDate(next7Days.getDate() + 7);
    next7Days.setHours(23, 59, 59, 999);

    const todayISODate = today.toISOString().split('T')[0];
    const next7DaysISODate = new Date(next7Days.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const dueNext7DaysItems = rawItems.filter((item: Doc<"todoist_items">) => {
      if (!item.due) return false;

      const dueDate = item.due.date;
      if (!dueDate) return false;

      if (dueDate.includes('T')) {
        const dueDateObj = new Date(dueDate);
        return dueDateObj >= today && dueDateObj <= next7Days;
      } else {
        return dueDate >= todayISODate && dueDate <= next7DaysISODate;
      }
    });

    const filteredItems = applyGlobalFilters(dueNext7DaysItems, {
      assigneeFilter: args.assigneeFilter,
      currentUserId: userId,
    });

    const sortedItems = filteredItems.sort((a, b) => {
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