import { defineTable } from "convex/server";
import { v } from "convex/values";

export const todoist_sections = defineTable({
  todoist_id: v.string(),
  name: v.string(),
  project_id: v.string(),
  section_order: v.number(),
  is_deleted: v.number(),
  is_archived: v.number(),
  sync_version: v.number(),
})
  .index("by_todoist_id", ["todoist_id"])
  .index("by_project", ["project_id"]);