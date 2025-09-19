import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Start with just items and projects
  todoist_items: defineTable({
    todoist_id: v.string(),
    content: v.string(),
    project_id: v.optional(v.string()),
    checked: v.number(), // 0 = unchecked, 1 = checked
    added_at: v.string(),
    sync_version: v.number(),
  }).index("by_todoist_id", ["todoist_id"]),

  todoist_projects: defineTable({
    todoist_id: v.string(),
    name: v.string(),
    color: v.string(),
    sync_version: v.number(),
  }).index("by_todoist_id", ["todoist_id"]),

  sync_state: defineTable({
    service: v.string(),
    last_sync_token: v.optional(v.string()),
    last_full_sync: v.string(),
  }).index("by_service", ["service"]),
});