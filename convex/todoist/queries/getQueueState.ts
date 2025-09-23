import { v } from "convex/values";

import { query } from "../../_generated/server";

/**
 * Get the current queue state for a user and queue
 */
export const getQueueState = query({
  args: {
    queueId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }
    const userId = identity.subject;

    const queueState = await ctx.db
      .query("todoist_queue_states")
      .withIndex("by_user_and_queue", (q) =>
        q.eq("userId", userId).eq("queueId", args.queueId)
      )
      .first();

    if (!queueState || !queueState.isActive) {
      return null;
    }

    // Get the current task from the snapshot
    const currentTaskId = queueState.taskSnapshot[queueState.currentIndex];
    let currentTask = null;

    if (currentTaskId) {
      currentTask = await ctx.db
        .query("todoist_items")
        .withIndex("by_todoist_id", (q) => q.eq("todoist_id", currentTaskId))
        .first();
    }

    return {
      ...queueState,
      currentTask,
      hasNext: queueState.currentIndex < queueState.totalTasks - 1,
      hasPrevious: queueState.currentIndex > 0,
      progressPercentage: queueState.totalTasks > 0
        ? Math.round((queueState.currentIndex / queueState.totalTasks) * 100)
        : 0,
    };
  },
});