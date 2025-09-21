import { internalMutation } from "../../_generated/server";
import { syncItemSchema } from "../types/syncApi";

export const upsertItem = internalMutation({
  args: { item: syncItemSchema },
  handler: async (ctx, { item }) => {
    const existing = await ctx.db
      .query("todoist_items")
      .withIndex("by_todoist_id", (q) => q.eq("todoist_id", item.id))
      .first();

    // Use updated_at as version since Sync API v1 doesn't provide version field
    const currentVersion = item.updated_at ? new Date(item.updated_at).getTime() : Date.now();

    const itemData = {
      todoist_id: item.id,
      content: item.content,
      description: item.description || undefined,
      project_id: item.project_id || undefined,
      section_id: item.section_id || undefined,
      parent_id: item.parent_id || undefined,
      child_order: item.child_order || 0,
      priority: item.priority || 1,
      due: item.due || undefined,
      labels: item.labels || [],
      assignee_id: item.assigned_by_uid || undefined,
      assigner_id: item.added_by_uid || undefined,
      comment_count: item.comment_count || 0,
      checked: typeof item.checked === 'boolean' ? (item.checked ? 1 : 0) : (item.checked || 0),
      is_deleted: item.is_deleted ? 1 : 0,
      added_at: item.added_at || new Date().toISOString(),
      completed_at: item.completed_at || undefined,
      user_id: item.user_id || "",
      sync_version: currentVersion,
    };

    if (existing) {
      if (existing.sync_version < itemData.sync_version) {
        await ctx.db.patch(existing._id, itemData);
      }
    } else {
      await ctx.db.insert("todoist_items", itemData);
    }
  },
});