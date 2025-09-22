import type { Label, UpdateLabelArgs } from "@doist/todoist-api-typescript";
import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

export const updateLabel = action({
  args: {
    labelId: v.string(),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    order: v.optional(v.number()),
    isFavorite: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<ActionResponse<Label>> => {
    try {
      const client = getTodoistClient();

      // Build UpdateLabelArgs for the SDK
      const updateArgs: UpdateLabelArgs = {
        name: args.name,
        color: args.color,
        order: args.order,
        isFavorite: args.isFavorite,
      };

      // Update label using SDK
      const label = await client.updateLabel(args.labelId, updateArgs);

      // Store in Convex using existing mutation
      await ctx.runMutation(internal.todoist.mutations.upsertLabel, {
        label: {
          id: label.id,
          name: label.name,
          color: label.color,
          item_order: label.order || 0,
          is_deleted: 0,
          is_favorite: label.isFavorite ? 1 : 0,
        },
      });

      return { success: true, data: label };
    } catch (error) {
      console.error("Failed to update label:", error);
      return {
        success: false,
        error: "Failed to update label. Please try again.",
        code: "UPDATE_LABEL_FAILED",
      };
    }
  },
});