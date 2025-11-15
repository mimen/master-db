import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";

/**
 * Daily routine task generation cron job
 * Runs at midnight (00:00) every day
 *
 * Tasks:
 * 1. Mark overdue tasks as 'missed'
 * 2. Mark tasks of deferred routines as 'deferred'
 * 3. Generate new tasks for all routines needing generation
 */
export const dailyRoutineGeneration = internalAction({
  handler: async (ctx) => {
    const startTime = Date.now();
    console.log("[CRON] Starting daily routine generation...");

    try {
      // Step 1: Update overdue tasks
      console.log("[CRON] Step 1: Updating overdue tasks...");
      const overdueResult = await ctx.runMutation(
        internal.routines.mutations.updateOverdueRoutineTasks
      );
      console.log(
        `[CRON] Marked ${overdueResult.missedCount} tasks as missed`
      );

      // Step 2: Handle deferred routines
      console.log("[CRON] Step 2: Handling deferred routines...");
      const deferredResult = await ctx.runMutation(
        internal.routines.mutations.handleDeferredRoutines
      );
      console.log(
        `[CRON] Marked ${deferredResult.deferredTaskCount} tasks as deferred for ${deferredResult.deferredRoutinesCount} routines`
      );

      // Step 3: Get routines needing generation
      console.log("[CRON] Step 3: Getting routines needing generation...");
      const routines = await ctx.runQuery(
        internal.routines.queries.getRoutinesNeedingGeneration
      );
      console.log(`[CRON] Found ${routines.length} routines needing generation`);

      // Step 4: Generate tasks for each routine
      let successCount = 0;
      let failureCount = 0;
      let totalTasksCreated = 0;

      for (const routine of routines) {
        try {
          console.log(`[CRON] Generating tasks for routine: ${routine.name}`);
          const result = await ctx.runAction(
            internal.routines.publicActions.generateAndCreateRoutineTasks,
            { routineId: routine._id }
          );

          if (result.success) {
            successCount++;
            totalTasksCreated += result.data.tasksCreated;
            console.log(
              `[CRON] ✓ ${routine.name}: ${result.data.tasksCreated} tasks created`
            );
          } else {
            failureCount++;
            console.error(
              `[CRON] ✗ ${routine.name}: ${result.error}`
            );
          }
        } catch (error) {
          failureCount++;
          console.error(
            `[CRON] ✗ ${routine.name}: Exception during generation:`,
            error
          );
        }
      }

      const duration = Date.now() - startTime;
      const summary = {
        duration,
        overdueTasksMarked: overdueResult.missedCount,
        deferredTasksMarked: deferredResult.deferredTaskCount,
        deferredRoutinesCount: deferredResult.deferredRoutinesCount,
        routinesProcessed: routines.length,
        routinesSuccess: successCount,
        routinesFailure: failureCount,
        totalTasksCreated,
      };

      console.log(
        `[CRON] Daily routine generation complete in ${duration}ms`,
        summary
      );

      return summary;
    } catch (error) {
      console.error("[CRON] Fatal error in daily routine generation:", error);
      throw error;
    }
  },
});
