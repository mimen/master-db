import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

export const deleteComment = action({
  args: {
    commentId: v.string(),
  },
  handler: async (ctx, args): Promise<ActionResponse<void>> => {
    try {
      const client = getTodoistClient();

      // Delete comment using SDK
      await client.deleteComment(args.commentId);

      // Mark as deleted in Convex using existing mutation
      await ctx.runMutation(internal.todoist.internalMutations.upsertNote.upsertNote, {
        note: {
          id: args.commentId,
          item_id: "", // Will be preserved from existing record
          content: "", // Will be preserved from existing record
          posted_uid: "", // Will be preserved from existing record
          posted_at: new Date().toISOString(),
          is_deleted: 1, // Mark as deleted
        },
      });

      return { success: true, data: undefined };
    } catch (error) {
      console.error("Failed to delete comment:", error);
      return {
        success: false,
        error: "Failed to delete comment. Please try again.",
        code: "DELETE_COMMENT_FAILED",
      };
    }
  },
});