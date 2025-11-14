import { v } from "convex/values";

import { mutation } from "../../_generated/server";

/**
 * Create or update a queue state for a user's queue session
 */
export const createQueueState = mutation({
  args: {
    queueId: v.string(),
    taskSnapshot: v.array(v.string()), // Array of task IDs in queue order
    currentIndex: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }
    const userId = identity.subject;

    const now = new Date().toISOString();

    // Check if there's already an active queue state for this user
    const existingState = await ctx.db
      .query("todoist_queue_states")
      .withIndex("by_user_and_queue", (q) =>
        q.eq("userId", userId).eq("queueId", args.queueId)
      )
      .first();

    const queueStateData = {
      userId,
      queueId: args.queueId,
      currentIndex: args.currentIndex || 0,
      totalTasks: args.taskSnapshot.length,
      sessionStartTime: now,
      sessionTasksProcessed: 0,
      skippedTaskIds: [],
      taskSnapshot: args.taskSnapshot,
      snapshotCreatedAt: now,
      isActive: true,
      lastAccessedAt: now,
      updatedAt: now,
    };

    if (existingState) {
      // Update existing state
      await ctx.db.patch(existingState._id, {
        ...queueStateData,
        createdAt: existingState.createdAt, // Preserve creation time
      });
      return existingState._id;
    } else {
      // Create new state
      return await ctx.db.insert("todoist_queue_states", {
        ...queueStateData,
        createdAt: now,
      });
    }
  },
});