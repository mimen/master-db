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
  deadline: v.optional(v.union(
    v.null(),
    v.object({
      date: v.string(),
      lang: v.string(),
    })
  )),
  labels: v.optional(v.array(v.string())),
  checked: v.optional(v.boolean()),
  is_deleted: v.optional(v.boolean()),
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

    // Build patch updates, handling null values appropriately
    // For clearable fields (due, deadline, completed_at), convert null to undefined to clear them
    // For other fields, skip null values (keep existing value)
    // Note: We use 'any' here because we're dynamically filtering properties
    // and TypeScript can't track the resulting type through Object.entries
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patchUpdates: any = {};

    const clearableFields = new Set(['due', 'deadline', 'completed_at']);

    for (const [key, value] of Object.entries(updates)) {
      if (value === null) {
        // For clearable fields, convert null to undefined to remove the field
        if (clearableFields.has(key)) {
          patchUpdates[key] = undefined;
        }
        // For other fields, skip null (preserve existing value)
      } else {
        // Non-null values are set directly
        patchUpdates[key] = value;
      }
    }

    // Apply updates
    await ctx.db.patch(existing._id, patchUpdates);
  },
});