import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";

export const undeferRoutine = internalMutation({
  args: {
    routineId: v.id("routines"),
  },
  handler: async (ctx, { routineId }) => {
    const routine = await ctx.db.get(routineId);
    if (!routine) {
      throw new Error(`Routine ${routineId} not found`);
    }

    // Undefer routine
    await ctx.db.patch(routineId, {
      defer: false,
      deferralDate: undefined,
      updatedAt: Date.now(),
    });

    // Note: We do NOT change existing deferred tasks back to pending
    // New tasks will be generated on next cron run

    return routineId;
  },
});
