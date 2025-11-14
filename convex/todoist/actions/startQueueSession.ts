import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { ActionCtx, action } from "../../_generated/server";

/**
 * Start a new queue session - creates queue state and returns initial task
 */
export const startQueueSession = action({
  args: {
    queueType: v.union(
      v.literal("priority"),
      v.literal("focused"),
      v.literal("context")
    ),
    queueOptions: v.optional(v.object({
      context: v.optional(v.string()),
      timeframe: v.optional(v.string()),
      context_type: v.optional(v.string()),
      max_tasks: v.optional(v.number()),
    })),
  },
  handler: async (ctx: ActionCtx, args) => {
    // Get tasks based on queue type
    let tasks;
    const queueId = `${args.queueType}-${Date.now()}`;

    switch (args.queueType) {
      case "priority":
        // @ts-expect-error - Type resolution issue with generated API
        tasks = await ctx.runQuery(internal.todoist.queries.getPriorityQueue, {
          max_tasks: args.queueOptions?.max_tasks || 7,
        });
        break;

      case "focused":
        // @ts-expect-error - Type resolution issue with generated API
        tasks = await ctx.runQuery(internal.todoist.queries.getFocusedTasks, {
          context: args.queueOptions?.context,
          timeframe: args.queueOptions?.timeframe,
          limit: args.queueOptions?.max_tasks || 10,
        });
        break;

      case "context":
        // @ts-expect-error - Type resolution issue with generated API
        tasks = await ctx.runQuery(internal.todoist.queries.getContextBatch, {
          context_type: args.queueOptions?.context_type,
          max_tasks: args.queueOptions?.max_tasks || 8,
        });
        break;

      default:
        throw new Error("Invalid queue type");
    }

    if (!tasks || tasks.length === 0) {
      return {
        success: false,
        message: "No tasks found for the specified queue criteria",
        queueState: null,
      };
    }

    // Create task snapshot (just the IDs in order)
    const taskSnapshot = tasks.map((task: { todoist_id: string }) => task.todoist_id);

    // Create queue state
    // @ts-expect-error - Type resolution issue with generated API
    const queueStateId = await ctx.runMutation(internal.todoist.publicMutations.createQueueState, {
      queueId,
      taskSnapshot,
      currentIndex: 0,
    });

    // Get the queue state with current task
    // @ts-expect-error - Type resolution issue with generated API
    const queueState = await ctx.runQuery(internal.todoist.queries.getQueueState, {
      queueId,
    });

    return {
      success: true,
      message: `Started ${args.queueType} queue with ${tasks.length} tasks`,
      queueState,
      queueStateId,
    };
  },
});