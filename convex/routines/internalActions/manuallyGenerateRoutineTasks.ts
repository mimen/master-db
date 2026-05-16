import { internal } from "../../_generated/api";
import { internalAction } from "../../_generated/server";

/**
 * Manually trigger routine task generation
 * Safe to call multiple times - duplicates prevented by generateTasksForRoutine
 *
 * Returns summary of generation results including:
 * - Tasks marked as missed/deferred
 * - Routines processed
 * - Total tasks created
 * - Any errors encountered
 */
export const manuallyGenerateRoutineTasks = internalAction({
  handler: async (ctx) => {
    const result = await ctx.runAction(
      internal.routines.internalActions.generateDailyRoutineTasks
        .generateDailyRoutineTasks
    );

    return result;
  },
});
