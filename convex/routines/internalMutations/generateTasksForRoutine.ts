import { v } from "convex/values";

import { internalMutation, type MutationCtx } from "../../_generated/server";
import { Frequency } from "../types/frequency";
import { RoutineTaskStatus } from "../types/status";
import {
  calculateNextReadyDate,
  calculateDueDate,
  getBusinessDaysAhead,
  getTwiceAWeekDates,
  shouldGenerateTask,
  normalizeToDay,
  adjustToIdealDay,
  addDays,
} from "../utils/dateCalculation";

export const generateTasksForRoutine = internalMutation({
  args: {
    routineId: v.id("routines"),
  },
  handler: async (ctx, { routineId }) => {
    const routine = await ctx.db.get(routineId);
    if (!routine) {
      throw new Error(`Routine ${routineId} not found`);
    }

    // Don't generate for deferred routines
    if (routine.defer) {
      return [];
    }

    // Get existing pending tasks to avoid duplicates
    const existingTasks = await ctx.db
      .query("routineTasks")
      .withIndex("routine_pending_tasks", (q) =>
        q.eq("routineId", routineId).eq("status", RoutineTaskStatus.Pending)
      )
      .collect();

    const existingDates = new Set(
      existingTasks.map((task) => normalizeToDay(task.readyDate))
    );

    // Generate tasks based on frequency
    const tasksToCreate: Array<{
      routineTaskId: string;
      readyDate: number;
      dueDate: number;
    }> = [];

    if (routine.frequency === Frequency.Daily) {
      // Generate up to 5 business days ahead
      const businessDays = getBusinessDaysAhead(Date.now(), 5);

      for (const date of businessDays) {
        const readyDate = date;

        if (shouldGenerateTask(routine, existingDates, readyDate)) {
          const dueDate = calculateDueDate(
            readyDate,
            routine.timeOfDay,
            routine.frequency
          );

          const routineTaskId = await createRoutineTask(
            ctx,
            routineId,
            readyDate,
            dueDate
          );

          tasksToCreate.push({ routineTaskId, readyDate, dueDate });
          existingDates.add(normalizeToDay(readyDate));
        }
      }
    } else if (routine.frequency === Frequency.TwiceAWeek) {
      // Generate Monday + Thursday for next 2 weeks (up to 4 tasks)
      const twiceAWeekDates = getTwiceAWeekDates(Date.now(), 2);

      for (const date of twiceAWeekDates) {
        const readyDate = date;

        if (shouldGenerateTask(routine, existingDates, readyDate)) {
          const dueDate = calculateDueDate(
            readyDate,
            routine.timeOfDay,
            routine.frequency
          );

          const routineTaskId = await createRoutineTask(
            ctx,
            routineId,
            readyDate,
            dueDate
          );

          tasksToCreate.push({ routineTaskId, readyDate, dueDate });
          existingDates.add(normalizeToDay(readyDate));
        }
      }
    } else {
      // Weekly, Every Other Week, Monthly, etc.
      // Generate 1-2 tasks based on lastCompletedDate + frequency
      const wasRecentlyUndeferred = Boolean(
        routine.deferralDate && Date.now() - routine.deferralDate < 86400000
      ); // Within 24 hours

      let readyDate = calculateNextReadyDate(
        routine,
        routine.lastCompletedDate,
        wasRecentlyUndeferred
      );

      // Apply ideal day if set
      if (routine.idealDay !== undefined) {
        readyDate = adjustToIdealDay(
          readyDate,
          routine.idealDay,
          routine.frequency
        );
      }

      // Generate first task
      if (shouldGenerateTask(routine, existingDates, readyDate)) {
        const dueDate = calculateDueDate(
          readyDate,
          routine.timeOfDay,
          routine.frequency
        );

        const routineTaskId = await createRoutineTask(
          ctx,
          routineId,
          readyDate,
          dueDate
        );

        tasksToCreate.push({ routineTaskId, readyDate, dueDate });
        existingDates.add(normalizeToDay(readyDate));
      }

      // Generate second task if first is close (within 3 days)
      const threeDaysFromNow = addDays(Date.now(), 3);
      if (readyDate < threeDaysFromNow) {
        const secondReadyDate = calculateNextReadyDate(routine, readyDate);

        let adjustedSecondReady = secondReadyDate;

        // Apply ideal day if set
        if (routine.idealDay !== undefined) {
          adjustedSecondReady = adjustToIdealDay(
            secondReadyDate,
            routine.idealDay,
            routine.frequency
          );
        }

        if (shouldGenerateTask(routine, existingDates, adjustedSecondReady)) {
          const dueDate = calculateDueDate(
            adjustedSecondReady,
            routine.timeOfDay,
            routine.frequency
          );

          const routineTaskId = await createRoutineTask(
            ctx,
            routineId,
            adjustedSecondReady,
            dueDate
          );

          tasksToCreate.push({
            routineTaskId,
            readyDate: adjustedSecondReady,
            dueDate,
          });
        }
      }
    }

    return tasksToCreate;
  },
});

/**
 * Helper to create a routineTask record
 */
async function createRoutineTask(
  ctx: MutationCtx,
  routineId: string,
  readyDate: number,
  dueDate: number
): Promise<string> {
  const now = Date.now();

  const routineTaskId = await ctx.db.insert("routineTasks", {
    routineId,
    todoistTaskId: "PENDING", // Will be updated when Todoist task created
    readyDate,
    dueDate,
    status: RoutineTaskStatus.Pending,
    completedDate: undefined,
    createdAt: now,
    updatedAt: now,
  });

  return routineTaskId;
}
