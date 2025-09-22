import type { Comment, UpdateCommentArgs } from "@doist/todoist-api-typescript";
import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

export const updateComment = action({
  args: {
    commentId: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args): Promise<ActionResponse<Comment>> => {
    try {
      const client = getTodoistClient();

      // Build UpdateCommentArgs for the SDK
      const updateArgs: UpdateCommentArgs = {
        content: args.content,
      };

      // Update comment using SDK
      const comment = await client.updateComment(args.commentId, updateArgs);

      // Store in Convex using existing mutation
      // Transform from Comment (camelCase) to syncNoteSchema (snake_case)
      await ctx.runMutation(internal.todoist.mutations.upsertNote, {
        note: {
          id: comment.id,
          item_id: comment.taskId || "", // Comments must have either taskId or projectId
          project_id: comment.projectId,
          content: comment.content,
          posted_uid: comment.postedUid,
          posted_at: comment.postedAt,
          is_deleted: comment.isDeleted ? 1 : 0,
          file_attachment: comment.fileAttachment ? {
            file_name: comment.fileAttachment.fileName || "",
            file_size: comment.fileAttachment.fileSize || 0,
            file_type: comment.fileAttachment.fileType || "",
            file_url: comment.fileAttachment.fileUrl || "",
            upload_state: comment.fileAttachment.uploadState || "completed",
          } : null,
          uids_to_notify: comment.uidsToNotify,
          reactions: comment.reactions,
        },
      });

      return { success: true, data: comment };
    } catch (error) {
      console.error("Failed to update comment:", error);
      return {
        success: false,
        error: "Failed to update comment. Please try again.",
        code: "UPDATE_COMMENT_FAILED",
      };
    }
  },
});