import { v } from "convex/values";

import { internalMutation } from "../../_generated/server";

/**
 * Mark a routine task as missed (task was manually skipped or deleted in Todoist)
 */
export const markRoutineTaskSkipped = internalMutation({
  args: {
    routineTaskId: v.id("routineTasks"),
  },
  handler: async (ctx, { routineTaskId }) => {
    const routineTask = await ctx.db.get(routineTaskId);
    if (!routineTask) {
      throw new Error(`Routine task not found: ${routineTaskId}`);
    }

    await ctx.db.patch(routineTaskId, {
      status: "missed",
      updatedAt: Date.now(),
    });

    return routineTask;
  },
});
