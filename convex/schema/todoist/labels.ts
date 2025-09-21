import { defineTable } from "convex/server";
import { v } from "convex/values";

export const todoist_labels = defineTable({
  todoist_id: v.string(),
  name: v.string(),
  color: v.string(),
  item_order: v.number(),
  is_deleted: v.number(),
  is_favorite: v.number(),
  sync_version: v.number(),
})
  .index("by_todoist_id", ["todoist_id"])
  .index("by_name", ["name"]);