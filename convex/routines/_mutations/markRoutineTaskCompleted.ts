import { mutation } from "../../_generated/server";
import { v } from "convex/values";

/**
 * Mark a routine task as completed
 */
export const markRoutineTaskCompleted = mutation({
  args: {
    routineTaskId: v.id("routineTasks"),
    completedDate: v.number(),
  },
  handler: async (ctx, { routineTaskId, completedDate }) => {
    const routineTask = await ctx.db.get(routineTaskId);
    if (!routineTask) {
      throw new Error(`Routine task not found: ${routineTaskId}`);
    }

    await ctx.db.patch(routineTaskId, {
      status: "completed",
      completedDate,
    });

    return routineTask;
  },
});
