import { defineTable } from "convex/server";
import { v } from "convex/values";

export const todoist_queue_states = defineTable({
  userId: v.string(),
  queueId: v.string(), // References queue_configs.id

  // Current position in queue
  currentIndex: v.number(),
  totalTasks: v.number(),

  // Group tracking
  currentGroup: v.optional(v.string()),
  tasksInGroup: v.optional(v.number()),
  tasksProcessedInGroup: v.optional(v.number()),

  // Session tracking
  sessionStartTime: v.string(),
  sessionTasksProcessed: v.number(),
  skippedTaskIds: v.array(v.string()),

  // Task snapshots for consistency
  taskSnapshot: v.array(v.string()), // Array of task IDs in order
  snapshotCreatedAt: v.string(),

  // State metadata
  isActive: v.boolean(),
  lastAccessedAt: v.string(),
  createdAt: v.string(),
  updatedAt: v.string(),
})
  .index("by_user", ["userId"])
  .index("by_user_and_queue", ["userId", "queueId"])
  .index("by_user_active", ["userId", "isActive"]);