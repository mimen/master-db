import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

export const completeTask = action({
  args: {
    todoistId: v.string(),
  },
  handler: async (ctx, args): Promise<ActionResponse<boolean>> => {
    // STEP 1: OPTIMISTIC UPDATE - Update Convex DB immediately for instant UI feedback
    await ctx.runMutation(internal.todoist.mutations.updateItem, {
      todoistId: args.todoistId,
      updates: {
        checked: true,
        completed_at: new Date().toISOString(),
        sync_version: Date.now(),
      },
    });

    try {
      const client = getTodoistClient();

      // STEP 2: REAL UPDATE - Send to Todoist API (this may take 200-500ms)
      const success = await client.closeTask(args.todoistId);

      if (!success) {
        // STEP 3a: ROLLBACK - API returned false, undo optimistic update
        await ctx.runMutation(internal.todoist.mutations.updateItem, {
          todoistId: args.todoistId,
          updates: {
            checked: false,
            completed_at: null,
            sync_version: Date.now(),
          },
        });

        return {
          success: false,
          error: "Failed to complete task on Todoist",
          code: "TODOIST_API_FAILED",
        };
      }

      // Success! The optimistic update was correct, no action needed
      return { success: true, data: success };
    } catch (error) {
      // STEP 3b: ROLLBACK - Exception occurred, undo optimistic update
      await ctx.runMutation(internal.todoist.mutations.updateItem, {
        todoistId: args.todoistId,
        updates: {
          checked: false,
          completed_at: null,
          sync_version: Date.now(),
        },
      });

      console.error("Failed to complete task:", error);
      return {
        success: false,
        error: "Failed to complete task. Please try again.",
        code: "COMPLETE_TASK_FAILED",
      };
    }
  },
});