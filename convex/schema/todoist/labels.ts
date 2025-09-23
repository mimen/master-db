import { defineTable } from "convex/server";
import { v } from "convex/values";

export const todoist_labels = defineTable({
  todoist_id: v.string(),
  name: v.string(),
  color: v.string(),
  order: v.number(), // Changed from item_order to match API
  is_deleted: v.boolean(), // Changed from number to boolean
  is_favorite: v.boolean(), // Changed from number to boolean
  sync_version: v.number(),
})
  .index("by_todoist_id", ["todoist_id"])
  .index("by_name", ["name"]);