import { defineTable } from "convex/server";
import { v } from "convex/values";

export const routineTasks = defineTable({
  // Link to parent routine
  routineId: v.id("routines"),

  // Link to Todoist task
  todoistTaskId: v.string(), // ID of the task in Todoist (or "PENDING" during creation)

  // Scheduling
  readyDate: v.number(), // Timestamp when task becomes actionable
  dueDate: v.number(), // Timestamp when task is due

  // Status tracking
  status: v.union(
    v.literal("pending"),
    v.literal("completed"),
    v.literal("missed"),
    v.literal("skipped"),
    v.literal("deferred")
  ),
  completedDate: v.optional(v.number()), // Timestamp when completed (if status=completed)

  // Metadata
  createdAt: v.number(), // Timestamp when routineTask created
  updatedAt: v.number(), // Timestamp of last status change
})
  .index("by_routine", ["routineId"])
  .index("by_status", ["status"])
  .index("by_todoist_task", ["todoistTaskId"])
  .index("routine_pending_tasks", ["routineId", "status"])
  .index("routine_tasks_by_date", ["routineId", "readyDate"]);
