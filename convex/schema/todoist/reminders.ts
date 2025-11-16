import { defineTable } from "convex/server";
import { v } from "convex/values";

// Reminder due date structure (simplified - reminders just have basic due info)
const reminderDueSchema = v.object({
  date: v.string(),
  is_recurring: v.optional(v.boolean()),
  string: v.optional(v.string()),
  lang: v.optional(v.string()),
  timezone: v.optional(v.union(v.string(), v.null())),
});

export const todoist_reminders = defineTable({
  todoist_id: v.string(),
  item_id: v.string(),
  type: v.string(),
  due: v.optional(v.union(reminderDueSchema, v.null())),
  mm_offset: v.optional(v.number()),
  is_deleted: v.number(),
  sync_version: v.number(),
})
  .index("by_todoist_id", ["todoist_id"])
  .index("by_item", ["item_id"]);