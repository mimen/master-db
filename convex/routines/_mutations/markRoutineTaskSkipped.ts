import { mutation } from "../../_generated/server";
import { v } from "convex/values";

/**
 * Mark a routine task as skipped (task was deleted in Todoist)
 */
export const markRoutineTaskSkipped = mutation({
  args: {
    routineTaskId: v.id("routineTasks"),
  },
  handler: async (ctx, { routineTaskId }) => {
    const routineTask = await ctx.db.get(routineTaskId);
    if (!routineTask) {
      throw new Error(`Routine task not found: ${routineTaskId}`);
    }

    await ctx.db.patch(routineTaskId, {
      status: "skipped",
    });

    return routineTask;
  },
});
