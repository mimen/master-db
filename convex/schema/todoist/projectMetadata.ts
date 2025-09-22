import { defineTable } from "convex/server";
import { v } from "convex/values";

export const todoist_project_metadata = defineTable({
  // Reference to the project
  project_id: v.string(), // todoist_id of the project

  // Metadata fields extracted from special tasks
  priority: v.optional(v.number()), // 1-4
  scheduled_date: v.optional(v.string()), // ISO date string
  description: v.optional(v.string()),

  // Project classification
  project_type: v.optional(v.union(
    v.literal("area-of-responsibility"),
    v.literal("project-type")
  )),

  // Tracking
  source_task_id: v.optional(v.string()), // todoist_id of the metadata task
  last_updated: v.number(), // timestamp

  // Sync tracking
  sync_version: v.number(),
})
  .index("by_project", ["project_id"])
  .index("by_priority", ["priority"])
  .index("by_scheduled", ["scheduled_date"])
  .index("by_type", ["project_type"]);