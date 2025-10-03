import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Multi-list configurations
 *
 * Stores user-defined multi-list sequences that can be composed
 * from existing view identifiers.
 */
export const todoist_multi_lists = defineTable({
  // Unique identifier (e.g., "priority-queue", "morning-review")
  id: v.string(),

  // Display name
  name: v.string(),

  // Optional icon (emoji or Lucide icon name)
  icon: v.optional(v.string()),

  // User ID (owner of this multi-list)
  userId: v.string(),

  // Sequence of view items
  sequence: v.array(
    v.object({
      // View identifier (reuses existing format)
      view: v.string(),

      // Optional display name override
      name: v.optional(v.string()),

      // Optional icon override
      icon: v.optional(v.string()),

      // Optional task limit
      maxTasks: v.optional(v.number()),
    })
  ),

  // Optional metadata
  description: v.optional(v.string()),
  estimatedMinutes: v.optional(v.number()),

  // System vs user-defined
  isBuiltIn: v.optional(v.boolean()),

  // Timestamps
  createdAt: v.string(),
  updatedAt: v.string(),
})
  .index("by_user", ["userId"])
  .index("by_user_and_id", ["userId", "id"])
  .index("by_built_in", ["isBuiltIn"]);
