import { v } from "convex/values";

import { mutation } from "../../_generated/server";

/**
 * Update queue progress when user completes, skips, or moves through tasks
 */
export const updateQueueProgress = mutation({
  args: {
    queueStateId: v.id("todoist_queue_states"),
    action: v.union(
      v.literal("next"),
      v.literal("previous"),
      v.literal("skip"),
      v.literal("complete"),
      v.literal("jump")
    ),
    newIndex: v.optional(v.number()),
    taskId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const queueState = await ctx.db.get(args.queueStateId);
    if (!queueState) {
      throw new Error("Queue state not found");
    }

    if (queueState.userId !== identity.subject) {
      throw new Error("Unauthorized");
    }

    const now = new Date().toISOString();
    let updates: any = {
      lastAccessedAt: now,
      updatedAt: now,
    };

    switch (args.action) {
      case "next":
        updates.currentIndex = Math.min(
          queueState.currentIndex + 1,
          queueState.totalTasks - 1
        );
        break;

      case "previous":
        updates.currentIndex = Math.max(queueState.currentIndex - 1, 0);
        break;

      case "skip":
        if (args.taskId) {
          updates.skippedTaskIds = [...queueState.skippedTaskIds, args.taskId];
        }
        updates.currentIndex = Math.min(
          queueState.currentIndex + 1,
          queueState.totalTasks - 1
        );
        break;

      case "complete":
        updates.sessionTasksProcessed = queueState.sessionTasksProcessed + 1;
        updates.currentIndex = Math.min(
          queueState.currentIndex + 1,
          queueState.totalTasks - 1
        );
        break;

      case "jump":
        if (args.newIndex !== undefined) {
          updates.currentIndex = Math.max(0, Math.min(
            args.newIndex,
            queueState.totalTasks - 1
          ));
        }
        break;
    }

    await ctx.db.patch(args.queueStateId, updates);

    return {
      ...queueState,
      ...updates,
    };
  },
});