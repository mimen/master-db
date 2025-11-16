import { defineTable } from "convex/server";
import { v } from "convex/values";

export const routines = defineTable({
  // Core routine properties
  name: v.string(),
  description: v.optional(v.string()),

  // Frequency and timing
  frequency: v.union(
    v.literal("Daily"),
    v.literal("Twice a Week"),
    v.literal("Weekly"),
    v.literal("Every Other Week"),
    v.literal("Monthly"),
    v.literal("Every Other Month"),
    v.literal("Quarterly"),
    v.literal("Twice a Year"),
    v.literal("Yearly"),
    v.literal("Every Other Year")
  ),
  duration: v.union(
    v.literal("5min"),
    v.literal("15min"),
    v.literal("30min"),
    v.literal("45min"),
    v.literal("1hr"),
    v.literal("2hr"),
    v.literal("3hr"),
    v.literal("4hr")
  ),

  // Scheduling preferences
  timeOfDay: v.optional(
    v.union(
      v.literal("Morning"),
      v.literal("Day"),
      v.literal("Evening"),
      v.literal("Night")
    )
  ),
  idealDay: v.optional(v.number()), // 0-6 for Sunday-Saturday (for weekly+ frequencies)

  // Todoist integration
  todoistProjectId: v.optional(v.string()), // Project to create tasks in (null = Inbox)
  todoistLabels: v.array(v.string()), // Additional labels beyond "routine"
  priority: v.number(), // 1-4 (maps to Todoist P4-P1)

  // State management
  defer: v.boolean(), // Temporarily pause task generation
  deferralDate: v.optional(v.number()), // Timestamp when deferred
  lastCompletedDate: v.optional(v.number()), // Most recent completion timestamp

  // Completion statistics
  completionRateOverall: v.number(), // 0-100, lifetime completion rate
  completionRateMonth: v.number(), // 0-100, last 30 days completion rate

  // Metadata
  createdAt: v.number(), // Timestamp when routine created
  updatedAt: v.number(), // Timestamp of last update
})
  .index("by_defer", ["defer"])
  .index("by_frequency", ["frequency"])
  .index("active_routines", ["defer", "createdAt"]);
