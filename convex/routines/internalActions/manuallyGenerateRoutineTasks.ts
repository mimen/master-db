import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";

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
export const manuallyGenerateRoutineTasks = action({
  handler: async (ctx) => {
    const result = await ctx.runAction(
      // @ts-expect-error - Convex type generation issue with internal API in barrel-exported actions
      internal.routines.internalActions.generateDailyRoutineTasks
        .generateDailyRoutineTasks
    );

    return result;
  },
});
