import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";

/**
 * Mark a routine task as pending (task was uncompleted in Todoist)
 */
export const markRoutineTaskPending = internalMutation({
  args: {
    routineTaskId: v.id("routineTasks"),
  },
  handler: async (ctx, { routineTaskId }) => {
    const routineTask = await ctx.db.get(routineTaskId);
    if (!routineTask) {
      throw new Error(`Routine task not found: ${routineTaskId}`);
    }

    await ctx.db.patch(routineTaskId, {
      status: "pending",
      completedDate: undefined,
    });

    return routineTask;
  },
});
