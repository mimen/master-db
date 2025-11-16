import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";

export const linkRoutineTask = internalMutation({
  args: {
    routineTaskId: v.id("routineTasks"),
    todoistTaskId: v.string(),
  },
  handler: async (ctx, { routineTaskId, todoistTaskId }) => {
    const routineTask = await ctx.db.get(routineTaskId);
    if (!routineTask) {
      throw new Error(`RoutineTask ${routineTaskId} not found`);
    }

    await ctx.db.patch(routineTaskId, {
      todoistTaskId,
      updatedAt: Date.now(),
    });

    return routineTaskId;
  },
});
