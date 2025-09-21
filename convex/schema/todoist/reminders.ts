import { defineTable } from "convex/server";
import { v } from "convex/values";

export const todoist_reminders = defineTable({
  todoist_id: v.string(),
  item_id: v.string(),
  type: v.string(),
  due: v.any(),
  mm_offset: v.optional(v.number()),
  is_deleted: v.number(),
  sync_version: v.number(),
})
  .index("by_todoist_id", ["todoist_id"])
  .index("by_item", ["item_id"]);