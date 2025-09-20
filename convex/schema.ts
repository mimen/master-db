import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Todoist Items (tasks)
  todoist_items: defineTable({
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
    .index("by_section", ["section_id"]),

  todoist_projects: defineTable({
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
    .index("active_projects", ["is_deleted", "is_archived"]),

  todoist_sections: defineTable({
    todoist_id: v.string(),
    name: v.string(),
    project_id: v.string(),
    section_order: v.number(),
    is_deleted: v.number(),
    is_archived: v.number(),
    sync_version: v.number(),
  })
    .index("by_todoist_id", ["todoist_id"])
    .index("by_project", ["project_id"]),

  todoist_labels: defineTable({
    todoist_id: v.string(),
    name: v.string(),
    color: v.string(),
    item_order: v.number(),
    is_deleted: v.number(),
    is_favorite: v.number(),
    sync_version: v.number(),
  })
    .index("by_todoist_id", ["todoist_id"])
    .index("by_name", ["name"]),

  todoist_notes: defineTable({
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
    .index("by_item", ["item_id"]),

  todoist_reminders: defineTable({
    todoist_id: v.string(),
    item_id: v.string(),
    type: v.string(),
    due: v.any(),
    mm_offset: v.optional(v.number()),
    is_deleted: v.number(),
    sync_version: v.number(),
  })
    .index("by_todoist_id", ["todoist_id"])
    .index("by_item", ["item_id"]),

  sync_state: defineTable({
    service: v.string(),
    last_sync_token: v.optional(v.string()),
    last_full_sync: v.string(),
    last_incremental_sync: v.optional(v.string()),
  }).index("by_service", ["service"]),
});