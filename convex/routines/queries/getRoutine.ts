import { v } from "convex/values";
import { query } from "../../_generated/server";

export const getRoutine = query({
  args: {
    routineId: v.id("routines"),
  },
  handler: async (ctx, { routineId }) => {
    const routine = await ctx.db.get(routineId);
    return routine;
  },
});
