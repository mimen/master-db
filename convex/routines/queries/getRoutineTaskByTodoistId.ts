import { v } from "convex/values";

import { internalQuery } from "../../_generated/server";
import { authedQuery } from "../../_lib/authed";

/**
 * Find a routine task by its Todoist task ID (internal version)
 * Used by webhook to link Todoist events to routine tasks
 */
export const getRoutineTaskByTodoistId = internalQuery({
  args: { todoistTaskId: v.string() },
  handler: async (ctx, { todoistTaskId }) => {
    return await ctx.db
      .query("routineTasks")
      .withIndex("by_todoist_task", (q) => q.eq("todoistTaskId", todoistTaskId))
      .first();
  },
});

/**
 * Find a routine task by its Todoist task ID (public version)
 * Used by UI to check if a task is a routine task
 */
export const getRoutineTaskByTodoistIdPublic = authedQuery({
  args: { todoistTaskId: v.string() },
  handler: async (ctx, { todoistTaskId }) => {
    return await ctx.db
      .query("routineTasks")
      .withIndex("by_todoist_task", (q) => q.eq("todoistTaskId", todoistTaskId))
      .first();
  },
});
