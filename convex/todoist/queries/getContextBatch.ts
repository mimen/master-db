import { v } from "convex/values";

import { query } from "../../_generated/server";
import { applyGlobalFilters } from "../helpers/globalFilters";
import { processQueue } from "../helpers/queueEngine";

/**
 * Group similar tasks by context to minimize context switching
 * Returns batches of tasks that can be done in the same mental/physical context
 */
export const getContextBatch = query({
  args: {
    context_type: v.union(
      v.literal("calls"),
      v.literal("emails"),
      v.literal("errands"),
      v.literal("admin"),
      v.literal("creative"),
      v.literal("development"),
      v.literal("all")
    ),
    include_low_priority: v.optional(v.boolean()),
    max_tasks: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const contextType = args.context_type;
    const includeLowPriority = args.include_low_priority || false;
    const maxTasks = args.max_tasks || 8;

    // Get all active items
    const allItems = await ctx.db
      .query("todoist_items")
      .filter((q) => q.eq(q.field("checked"), false))
      .filter((q) => q.eq(q.field("is_deleted"), false))
      .collect();

    // Get current user ID for assignee filtering
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;

    // Define context-specific label mappings
    const contextLabels = {
      calls: ["call", "phone", "meeting", "video", "zoom", "interview"],
      emails: ["email", "respond", "reply", "follow-up", "newsletter"],
      errands: ["errands", "shopping", "pickup", "dropoff", "appointment", "bank"],
      admin: ["admin", "paperwork", "filing", "taxes", "insurance", "bureaucracy"],
      creative: ["creative", "design", "writing", "brainstorm", "plan", "research"],
      development: ["code", "dev", "programming", "debug", "review", "deploy"],
    };

    // Build filters
    const filters = [];

    // Context-specific label filtering
    if (contextType !== "all") {
      const labels = contextLabels[contextType as keyof typeof contextLabels] || [];
      if (labels.length > 0) {
        filters.push({
          type: "label" as const,
          labels,
          mode: "include" as const,
        });
      }
    }

    // Priority filtering
    if (!includeLowPriority) {
      filters.push({
        type: "priority" as const,
        minPriority: 2, // P1, P2, P3 only (exclude P4)
        mode: "include" as const,
      });
    }

    // Context-specific ordering
    let ordering;

    if (contextType === "calls" || contextType === "emails") {
      // For communication: prioritize by urgency and due dates
      ordering = [
        { field: "priority", direction: "desc" as const },
        { field: "dueDate", direction: "asc" as const, nullsFirst: false },
        { field: "createdDate", direction: "asc" as const }, // Older first
      ];
    } else if (contextType === "errands") {
      // For errands: group by location/convenience, then priority
      ordering = [
        { field: "dueDate", direction: "asc" as const, nullsFirst: false },
        { field: "priority", direction: "desc" as const },
        { field: "childOrder", direction: "asc" as const },
      ];
    } else if (contextType === "creative" || contextType === "development") {
      // For deep work: prioritize by importance and complexity
      ordering = [
        { field: "priority", direction: "desc" as const },
        { field: "childOrder", direction: "asc" as const }, // Original order for workflow
      ];
    } else {
      // Default ordering for admin and general tasks
      ordering = [
        { field: "priority", direction: "desc" as const },
        { field: "dueDate", direction: "asc" as const, nullsFirst: false },
        { field: "childOrder", direction: "asc" as const },
      ];
    }

    const queueConfig = {
      filters,
      ordering,
      maxTasks,
    };

    // Process the queue
    const processedItems = processQueue(allItems, queueConfig, userId);

    // Apply global filters (excluding assignee filter to keep team tasks for context batching)
    return applyGlobalFilters(processedItems, {
      assigneeFilter: 'all', // Include all tasks for context batching
      currentUserId: userId,
    });
  },
});