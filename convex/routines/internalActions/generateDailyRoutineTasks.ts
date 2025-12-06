import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { getTodoistClient } from "../../todoist/actions/utils/todoistClient";

/**
 * Generate daily routine tasks
 * Shared orchestration logic used by both cron and manual trigger
 *
 * Steps:
 * 1. Mark overdue tasks as 'missed' (>2 days)
 * 2. Complete auto-missed tasks in Todoist
 * 3. Mark tasks of deferred routines as 'deferred'
 * 4. Get routines needing generation
 * 5. Generate new tasks for each routine
 */
export const generateDailyRoutineTasks = internalAction({
  handler: async (ctx) => {
    const startTime = Date.now();

    // Step 1: Update overdue tasks (mark as missed after 2 days)
    const overdueResult = await ctx.runMutation(
      // @ts-expect-error - Convex type generation issue with internal API in barrel-exported internalMutations
      internal.routines.internalMutations.updateOverdueRoutineTasks.updateOverdueRoutineTasks
    );

    // Step 2: Complete auto-missed tasks in Todoist
    const client = getTodoistClient();
    let todoistCompletedCount = 0;
    let todoistFailedCount = 0;

    for (const todoistTaskId of overdueResult.missedTaskIds) {
      try {
        const success = await client.closeTask(todoistTaskId);
        if (success) {
          todoistCompletedCount++;
        } else {
          todoistFailedCount++;
          console.warn(`Failed to complete missed task in Todoist: ${todoistTaskId}`);
        }
      } catch (error) {
        todoistFailedCount++;
        console.error(`Error completing missed task ${todoistTaskId}:`, error);
      }
    }

    // Step 2b: Recalculate completion rates for affected routines
    for (const routineId of overdueResult.affectedRoutineIds) {
      try {
        await ctx.runMutation(
          internal.routines.internalMutations.recalculateRoutineCompletionRate.recalculateRoutineCompletionRate,
          { routineId }
        );
      } catch (error) {
        console.error(`Failed to recalculate routine ${routineId}:`, error);
      }
    }

    // Step 3: Handle deferred routines
    const deferredResult = await ctx.runMutation(
      // @ts-expect-error - Convex type generation issue with internal API in barrel-exported internalMutations
      internal.routines.internalMutations.handleDeferredRoutines.handleDeferredRoutines
    );

    // Step 4: Get routines needing generation
    const routines = await ctx.runQuery(
      // @ts-expect-error - Convex type generation issue with internal API in barrel-exported internalQueries
      internal.routines.internalQueries.getRoutinesNeedingGeneration.getRoutinesNeedingGeneration
    );

    // Step 5: Generate tasks for each routine
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
      autoMissedTasks: overdueResult.missedCount,
      todoistCompletedCount,
      todoistFailedCount,
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
