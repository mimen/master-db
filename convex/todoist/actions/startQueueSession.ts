import { v } from "convex/values";
import { action } from "../../_generated/server";
import { api } from "../../_generated/api";

/**
 * Start a new queue session - creates queue state and returns initial task
 */
export const startQueueSession: any = action({
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
  handler: async (ctx, args) => {
    // Get tasks based on queue type
    let tasks;
    const queueId = `${args.queueType}-${Date.now()}`;
    
    switch (args.queueType) {
      case "priority":
        tasks = await ctx.runQuery(api.todoist.publicQueries.getPriorityQueue, {
          max_tasks: args.queueOptions?.max_tasks || 7,
        });
        break;
        
      case "focused":
        tasks = await ctx.runQuery(api.todoist.publicQueries.getFocusedTasks, {
          context: args.queueOptions?.context as any,
          timeframe: args.queueOptions?.timeframe as any,
          limit: args.queueOptions?.max_tasks || 10,
        });
        break;
        
      case "context":
        tasks = await ctx.runQuery(api.todoist.publicQueries.getContextBatch, {
          context_type: args.queueOptions?.context_type as any,
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
    const taskSnapshot = tasks.map((task: any) => task.todoist_id);
    
    // Create queue state
    const queueStateId = await ctx.runMutation(api.todoist.publicMutations.createQueueState, {
      queueId,
      taskSnapshot,
      currentIndex: 0,
    });
    
    // Get the queue state with current task
    const queueState = await ctx.runQuery(api.todoist.publicQueries.getQueueState, {
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