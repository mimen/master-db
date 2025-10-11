import { v } from "convex/values";

import { internalQuery } from "../../_generated/server";

/**
 * Internal query to get a task by its Todoist ID
 * Used for optimistic update rollback
 */
export const getItemByTodoistId = internalQuery({
  args: {
    todoistId: v.string(),
  },
  handler: async (ctx, { todoistId }) => {
    const item = await ctx.db
      .query("todoist_items")
      .withIndex("by_todoist_id", (q) => q.eq("todoist_id", todoistId))
      .first();

    return item;
  },
});
