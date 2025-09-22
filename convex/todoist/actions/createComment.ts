import type { Comment, AddCommentArgs } from "@doist/todoist-api-typescript";
import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

export const createComment = action({
  args: {
    content: v.string(),
    taskId: v.optional(v.string()),
    projectId: v.optional(v.string()),
    attachment: v.optional(v.object({
      fileName: v.optional(v.string()),
      fileUrl: v.string(),
      fileType: v.optional(v.string()),
      resourceType: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args): Promise<ActionResponse<Comment>> => {
    try {
      // Validate that either taskId or projectId is provided, but not both
      if (!args.taskId && !args.projectId) {
        return {
          success: false,
          error: "Either taskId or projectId must be provided",
          code: "INVALID_ARGS",
        };
      }
      if (args.taskId && args.projectId) {
        return {
          success: false,
          error: "Cannot provide both taskId and projectId",
          code: "INVALID_ARGS",
        };
      }

      const client = getTodoistClient();

      // Build AddCommentArgs for the SDK
      const commentArgs: AddCommentArgs = args.taskId
        ? {
            content: args.content,
            taskId: args.taskId,
            attachment: args.attachment,
          }
        : {
            content: args.content,
            projectId: args.projectId!,
            attachment: args.attachment,
          };

      // Create comment using SDK
      const comment = await client.addComment(commentArgs);

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
      console.error("Failed to create comment:", error);
      return {
        success: false,
        error: "Failed to create comment. Please try again.",
        code: "CREATE_COMMENT_FAILED",
      };
    }
  },
});