import { v } from "convex/values";

import { internalMutation } from "../../_generated/server";
import { syncItemSchema } from "../types/syncApi";

export const upsertItem = internalMutation({
  args: {
    item: syncItemSchema,
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, { item, force }) => {
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
      project_id: item.project_id === null ? undefined : item.project_id,
      section_id: item.section_id === null ? undefined : item.section_id,
      parent_id: item.parent_id === null ? undefined : item.parent_id,
      child_order: item.child_order || 0,
      priority: item.priority || 1,
      due: item.due === null ? undefined : item.due,
      deadline: item.deadline === null ? undefined : item.deadline,
      duration: item.duration === null ? undefined : item.duration,
      labels: item.labels || [],
      assignee_id: item.responsible_uid === null ? undefined : item.responsible_uid,
      assigner_id: item.assigned_by_uid === null ? undefined : item.assigned_by_uid,
      responsible_uid: item.responsible_uid === null ? undefined : item.responsible_uid,
      comment_count: item.comment_count || 0,
      checked: typeof item.checked === 'boolean' ? item.checked : Boolean(item.checked),
      is_deleted: Boolean(item.is_deleted),
      added_at: item.added_at || new Date().toISOString(),
      date_added: item.date_added === null ? undefined : item.date_added,
      completed_at: item.completed_at === null ? undefined : item.completed_at,
      date_completed: item.date_completed === null ? undefined : item.date_completed,
      updated_at: item.updated_at === null ? undefined : item.updated_at,
      user_id: item.user_id || "",
      sync_version: currentVersion,
    };

    if (existing) {
      // Update if: force flag is set, or version is newer
      if (force || existing.sync_version < itemData.sync_version) {
        await ctx.db.patch(existing._id, itemData);
      }
    } else {
      await ctx.db.insert("todoist_items", itemData);
    }
  },
});