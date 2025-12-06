import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";

/**
 * Daily routine task generation cron job
 * Runs at midnight (00:00) every day
 *
 * Tasks:
 * 1. Mark overdue tasks as 'missed' (>2 days) and complete them in Todoist
 * 2. Mark tasks of deferred routines as 'deferred'
 * 3. Generate new tasks for all routines needing generation
 */
export const dailyRoutineGeneration = internalAction({
  handler: async (ctx) => {
    console.log("[CRON] Starting daily routine generation...");

    try {
      const result = await ctx.runAction(
        // @ts-expect-error - Convex type generation issue with internal API in barrel-exported internalActions
        internal.routines.internalActions.generateDailyRoutineTasks
          .generateDailyRoutineTasks
      );

      console.log(
        `[CRON] Daily routine generation complete in ${result.duration}ms`,
        result
      );

      return result;
    } catch (error) {
      console.error("[CRON] Fatal error in daily routine generation:", error);
      throw error;
    }
  },
});
