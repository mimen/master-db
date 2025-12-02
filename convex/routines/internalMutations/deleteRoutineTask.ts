import { v } from "convex/values";

import { internalMutation } from "../../_generated/server";

/**
 * Delete a routine task record from the database
 * Used when clearing pending routine tasks
 */
export const deleteRoutineTask = internalMutation({
  args: { routineTaskId: v.id("routineTasks") },
  handler: async (ctx, { routineTaskId }) => {
    await ctx.db.delete(routineTaskId);
  },
});
