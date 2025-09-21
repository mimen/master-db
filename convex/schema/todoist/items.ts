import { defineTable } from "convex/server";
import { v } from "convex/values";

export const todoist_items = defineTable({
  todoist_id: v.string(),
  content: v.string(),
  description: v.optional(v.string()),
  project_id: v.optional(v.string()),
  section_id: v.optional(v.string()),
  parent_id: v.optional(v.string()),
  child_order: v.number(),
  priority: v.number(),
  due: v.optional(v.any()),
  labels: v.array(v.string()),
  assignee_id: v.optional(v.string()),
  assigner_id: v.optional(v.string()),
  comment_count: v.number(),
  checked: v.number(), // 0 = unchecked, 1 = checked
  is_deleted: v.number(),
  added_at: v.string(),
  completed_at: v.optional(v.string()),
  user_id: v.string(),
  sync_version: v.number(),
})
  .index("by_todoist_id", ["todoist_id"])
  .index("by_project", ["project_id"])
  .index("by_section", ["section_id"]);