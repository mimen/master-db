import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

export const deleteLabel = action({
  args: {
    labelId: v.string(),
  },
  handler: async (ctx, args): Promise<ActionResponse<void>> => {
    try {
      const client = getTodoistClient();

      // Delete label using SDK
      await client.deleteLabel(args.labelId);

      // Mark as deleted in Convex using existing mutation
      await ctx.runMutation(internal.todoist.mutations.upsertLabel, {
        label: {
          id: args.labelId,
          name: "", // Name will be preserved from existing record
          color: "charcoal", // Default color
          item_order: 0,
          is_deleted: true, // Mark as deleted
          is_favorite: false,
        },
      });

      return { success: true, data: undefined };
    } catch (error) {
      console.error("Failed to delete label:", error);
      return {
        success: false,
        error: "Failed to delete label. Please try again.",
        code: "DELETE_LABEL_FAILED",
      };
    }
  },
});