import { internalQuery } from "../../_generated/server";
import { v } from "convex/values";

/**
 * Find a routine task by its Todoist task ID
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
