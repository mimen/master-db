import { v } from "convex/values";

import { internalMutation } from "../../_generated/server";

// Schema for partial updates to a Todoist item
const itemUpdateSchema = v.object({
  content: v.optional(v.string()),
  description: v.optional(v.string()),
  project_id: v.optional(v.string()),
  section_id: v.optional(v.string()),
  priority: v.optional(v.number()),
  due: v.optional(v.union(
    v.null(),
    v.object({
      date: v.string(),
      is_recurring: v.optional(v.boolean()),
      string: v.optional(v.string()),
      datetime: v.optional(v.string()),
      timezone: v.optional(v.union(v.string(), v.null())),
    })
  )),
  labels: v.optional(v.array(v.string())),
  checked: v.optional(v.number()),
  is_deleted: v.optional(v.number()),
  completed_at: v.optional(v.union(v.string(), v.null())),
  updated_at: v.optional(v.string()),
  sync_version: v.optional(v.number()),
});

export const updateItem = internalMutation({
  args: {
    todoistId: v.string(),
    updates: itemUpdateSchema,
  },
  handler: async (ctx, { todoistId, updates }) => {
    const existing = await ctx.db
      .query("todoist_items")
      .withIndex("by_todoist_id", (q) => q.eq("todoist_id", todoistId))
      .first();

    if (!existing) {
      console.error(`Item not found: ${todoistId}`);
      return;
    }

    // Filter out null values and convert them to undefined for patch
    const patchUpdates: any = { ...updates };
    if (patchUpdates.due === null) {
      delete patchUpdates.due;
    }
    if (patchUpdates.completed_at === null) {
      delete patchUpdates.completed_at;
    }

    // Apply updates
    await ctx.db.patch(existing._id, patchUpdates);
  },
});