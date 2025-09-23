import { defineTable } from "convex/server";
import { v } from "convex/values";

export const todoist_projects = defineTable({
  todoist_id: v.string(),
  name: v.string(),
  color: v.string(),
  parent_id: v.optional(v.string()),
  child_order: v.number(),
  collapsed: v.optional(v.boolean()), // Added missing field
  shared: v.optional(v.boolean()), // Added missing field
  is_deleted: v.boolean(), // Changed from number to boolean
  is_archived: v.boolean(), // Changed from number to boolean
  is_favorite: v.boolean(), // Changed from number to boolean
  view_style: v.string(),
  // Additional fields from v1 API that might be useful
  description: v.optional(v.string()), // Added missing field
  can_assign_tasks: v.optional(v.boolean()), // Added missing field
  is_shared: v.optional(v.boolean()), // Added missing field (different from shared)
  inbox_project: v.optional(v.boolean()), // Added missing field
  created_at: v.optional(v.string()),
  updated_at: v.optional(v.string()),
  sync_version: v.number(),
})
  .index("by_todoist_id", ["todoist_id"])
  .index("active_projects", ["is_deleted", "is_archived"]);