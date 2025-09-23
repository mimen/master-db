import { defineTable } from "convex/server";
import { v } from "convex/values";

// Filter schema - each filter type has its own structure
const filterSchema = v.union(
  // Project filter
  v.object({
    type: v.literal("project"),
    mode: v.optional(v.union(v.literal("include"), v.literal("exclude"))),
    projectIds: v.array(v.string()),
    includeSubprojects: v.optional(v.boolean()),
  }),
  // Priority filter
  v.object({
    type: v.literal("priority"),
    mode: v.optional(v.union(v.literal("include"), v.literal("exclude"))),
    priorities: v.array(v.number()), // [1,2,3,4]
    minPriority: v.optional(v.number()),
  }),
  // Project Priority filter
  v.object({
    type: v.literal("projectPriority"),
    mode: v.optional(v.union(v.literal("include"), v.literal("exclude"))),
    priorities: v.array(v.number()), // [1,2,3,4]
    minPriority: v.optional(v.number()),
  }),
  // Label filter
  v.object({
    type: v.literal("label"),
    mode: v.optional(v.union(v.literal("include"), v.literal("exclude"))),
    labels: v.array(v.string()),
  }),
  // Date filter
  v.object({
    type: v.literal("date"),
    mode: v.optional(v.union(v.literal("include"), v.literal("exclude"))),
    range: v.union(
      v.literal("overdue"),
      v.literal("today"),
      v.literal("tomorrow"),
      v.literal("next7days"),
      v.literal("future"),
      v.literal("none")
    ),
    includeDeadlines: v.optional(v.boolean()),
    combineDueAndDeadline: v.optional(v.boolean()),
  }),
  // Custom filter for complex conditions
  v.object({
    type: v.literal("custom"),
    mode: v.optional(v.union(v.literal("include"), v.literal("exclude"))),
    condition: v.union(
      v.literal("overdue"),
      v.literal("no-date"),
      v.literal("has-subtasks"),
      v.literal("no-subtasks"),
      v.literal("recurring"),
      v.literal("non-recurring")
    ),
  }),
  // Assignee filter
  v.object({
    type: v.literal("assignee"),
    mode: v.optional(v.union(v.literal("include"), v.literal("exclude"))),
    filter: v.union(
      v.literal("all"),
      v.literal("unassigned"),
      v.literal("assigned-to-me"),
      v.literal("assigned-to-others"),
      v.literal("not-assigned-to-others")
    ),
  })
);

// Ordering rule schema
const orderingRuleSchema = v.object({
  field: v.union(
    v.literal("priority"),
    v.literal("dueDate"),
    v.literal("deadline"),
    v.literal("createdDate"),
    v.literal("childOrder"),
    v.literal("content"),
    v.literal("projectPriority"),
    v.literal("labelPriority")
  ),
  direction: v.union(v.literal("asc"), v.literal("desc")),
  nullsFirst: v.optional(v.boolean()),
});

// Grouping configuration schema
const groupingConfigSchema = v.object({
  field: v.union(
    v.literal("projectId"),
    v.literal("priority"),
    v.literal("dueDate"),
    v.literal("section")
  ),
  showHeaders: v.boolean(),
  collapsible: v.optional(v.boolean()),
});

export const todoist_queue_configs = defineTable({
  id: v.string(), // User-defined queue ID
  name: v.string(),
  description: v.optional(v.string()),
  userId: v.string(), // Owner of this queue configuration

  // Core queue configuration
  filters: v.array(filterSchema),
  ordering: v.array(orderingRuleSchema),
  grouping: v.optional(groupingConfigSchema),

  // Queue behavior settings
  maxTasks: v.optional(v.number()), // Limit queue size
  defaultTimeFrame: v.optional(v.string()), // "today", "week", etc.

  // UI preferences
  showProgressIndicator: v.optional(v.boolean()),
  enableBatching: v.optional(v.boolean()),
  breakReminders: v.optional(v.array(v.number())), // Task counts to show breaks

  // Metadata
  isDefault: v.optional(v.boolean()),
  isActive: v.optional(v.boolean()),
  createdAt: v.string(),
  updatedAt: v.string(),
})
  .index("by_user", ["userId"])
  .index("by_user_and_id", ["userId", "id"])
  .index("by_user_defaults", ["userId", "isDefault"]);