import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";

export const getRoutineTask = internalQuery({
  args: {
    routineTaskId: v.id("routineTasks"),
  },
  handler: async (ctx, { routineTaskId }) => {
    const routineTask = await ctx.db.get(routineTaskId);
    return routineTask;
  },
});
