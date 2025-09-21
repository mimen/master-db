import { v } from "convex/values";

import { internalMutation } from "../../_generated/server";

export const upsertLabel = internalMutation({
  args: { label: v.any() },
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
      color: label.color,
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