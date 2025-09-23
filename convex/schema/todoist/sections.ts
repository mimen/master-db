import { defineTable } from "convex/server";
import { v } from "convex/values";

export const todoist_sections = defineTable({
  todoist_id: v.string(),
  name: v.string(),
  project_id: v.string(),
  section_order: v.number(),
  collapsed: v.optional(v.boolean()), // Added missing field
  is_deleted: v.boolean(), // Changed from number to boolean
  is_archived: v.boolean(), // Changed from number to boolean
  sync_version: v.number(),
})
  .index("by_todoist_id", ["todoist_id"])
  .index("by_project", ["project_id"]);