import { defineTable } from "convex/server";
import { v } from "convex/values";

export const todoist_notes = defineTable({
  todoist_id: v.string(),
  item_id: v.string(),
  project_id: v.optional(v.string()),
  content: v.string(),
  posted_uid: v.string(),
  is_deleted: v.number(),
  posted_at: v.string(),
  sync_version: v.number(),
})
  .index("by_todoist_id", ["todoist_id"])
  .index("by_item", ["item_id"]);