import { internalMutation } from "../../_generated/server";
import { syncLabelSchema } from "../types/syncApi";

export const upsertLabel = internalMutation({
  args: { label: syncLabelSchema },
  handler: async (ctx, { label }) => {
    const existing = await ctx.db
      .query("todoist_labels")
      .withIndex("by_todoist_id", (q) => q.eq("todoist_id", label.id))
      .first();

    // Use timestamp as version since Sync API v1 doesn't provide version field
    const currentVersion = Date.now();

    const labelData = {
      todoist_id: label.id,
      name: label.name,
      color: label.color || "charcoal", // Default to charcoal if no color provided
      item_order: label.item_order || 0,
      is_deleted: label.is_deleted ? 1 : 0,
      is_favorite: label.is_favorite ? 1 : 0,
      sync_version: currentVersion,
    };

    if (existing) {
      if (existing.sync_version < labelData.sync_version) {
        await ctx.db.patch(existing._id, labelData);
      }
    } else {
      await ctx.db.insert("todoist_labels", labelData);
    }
  },
});