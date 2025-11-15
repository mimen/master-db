import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";

export const getRoutine = internalQuery({
  args: {
    routineId: v.id("routines"),
  },
  handler: async (ctx, { routineId }) => {
    const routine = await ctx.db.get(routineId);
    return routine;
  },
});
