import type { Label, AddLabelArgs } from "@doist/todoist-api-typescript";
import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

export const createLabel = action({
  args: {
    name: v.string(),
    color: v.optional(v.string()),
    order: v.optional(v.number()),
    isFavorite: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<ActionResponse<Label>> => {
    try {
      const client = getTodoistClient();

      // Build AddLabelArgs for the SDK
      const labelArgs: AddLabelArgs = {
        name: args.name,
        color: args.color,
        order: args.order,
        isFavorite: args.isFavorite,
      };

      // Create label using SDK
      const label = await client.addLabel(labelArgs);

      // Store in Convex using existing mutation
      await ctx.runMutation(internal.todoist.internalMutations.upsertLabel.upsertLabel, {
        label: {
          id: label.id,
          name: label.name,
          color: label.color,
          item_order: label.order || 0,
          is_deleted: false,
          is_favorite: Boolean(label.isFavorite),
        },
      });

      return { success: true, data: label };
    } catch (error) {
      console.error("Failed to create label:", error);
      return {
        success: false,
        error: "Failed to create label. Please try again.",
        code: "CREATE_LABEL_FAILED",
      };
    }
  },
});