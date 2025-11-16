import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";

/**
 * Generate daily routine tasks
 * Shared orchestration logic used by both cron and manual trigger
 *
 * Steps:
 * 1. Mark overdue tasks as 'missed'
 * 2. Mark tasks of deferred routines as 'deferred'
 * 3. Get routines needing generation
 * 4. Generate new tasks for each routine
 */
export const generateDailyRoutineTasks = internalAction({
  handler: async (ctx) => {
    const startTime = Date.now();

    // Step 1: Update overdue tasks
    const overdueResult = await ctx.runMutation(
      internal.routines.internalMutations.updateOverdueRoutineTasks.updateOverdueRoutineTasks
    );

    // Step 2: Handle deferred routines
    const deferredResult = await ctx.runMutation(
      internal.routines.internalMutations.handleDeferredRoutines.handleDeferredRoutines
    );

    // Step 3: Get routines needing generation
    const routines = await ctx.runQuery(
      internal.routines.internalQueries.getRoutinesNeedingGeneration.getRoutinesNeedingGeneration
    );

    // Step 4: Generate tasks for each routine
    let successCount = 0;
    let failureCount = 0;
    let totalTasksCreated = 0;
    const errors: string[] = [];

    for (const routine of routines) {
      try {
        const result = await ctx.runAction(
          internal.routines.internalActions.generateAndCreateRoutineTasks.generateAndCreateRoutineTasks,
          { routineId: routine._id }
        );

        if (result.success) {
          successCount++;
          totalTasksCreated += result.data.tasksCreated;
        } else {
          failureCount++;
          errors.push(`${routine.name}: ${result.error}`);
        }
      } catch (error) {
        failureCount++;
        errors.push(
          `${routine.name}: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    }

    const duration = Date.now() - startTime;

    return {
      duration,
      overdueTasksMarked: overdueResult.missedCount,
      deferredTasksMarked: deferredResult.deferredTaskCount,
      deferredRoutinesCount: deferredResult.deferredRoutinesCount,
      routinesProcessed: routines.length,
      routinesSuccess: successCount,
      routinesFailure: failureCount,
      totalTasksCreated,
      errors: errors.length > 0 ? errors : undefined,
    };
  },
});
