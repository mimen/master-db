import { defineTable } from "convex/server";
import { v } from "convex/values";

export const todoist_projects = defineTable({
  todoist_id: v.string(),
  name: v.string(),
  color: v.string(),
  parent_id: v.optional(v.string()),
  child_order: v.number(),
  is_deleted: v.number(),
  is_archived: v.number(),
  is_favorite: v.number(),
  view_style: v.string(),
  sync_version: v.number(),
})
  .index("by_todoist_id", ["todoist_id"])
  .index("active_projects", ["is_deleted", "is_archived"]);