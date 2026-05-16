import { v } from "convex/values";

import { authedQuery } from "../../_lib/authed";
import { RoutineTaskStatus } from "../types/status";

export const getRoutineTasks = authedQuery({
  args: {
    routineId: v.id("routines"),
    statusFilter: v.optional(
      v.union(
        v.literal(RoutineTaskStatus.Pending),
        v.literal(RoutineTaskStatus.Completed),
        v.literal(RoutineTaskStatus.Missed),
        v.literal(RoutineTaskStatus.Skipped),
        v.literal(RoutineTaskStatus.Deferred),
        v.literal("all")
      )
    ),
  },
  handler: async (ctx, { routineId, statusFilter = "all" }) => {
    let tasksQuery = ctx.db
      .query("routineTasks")
      .withIndex("by_routine", (q) => q.eq("routineId", routineId));

    const tasks = await tasksQuery.collect();

    // Filter by status if specified
    const filteredTasks =
      statusFilter === "all"
        ? tasks
        : tasks.filter((task) => task.status === statusFilter);

    // Sort by readyDate descending (most recent first)
    return filteredTasks.sort((a, b) => b.readyDate - a.readyDate);
  },
});
