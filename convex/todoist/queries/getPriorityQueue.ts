import { v } from "convex/values";
import { query } from "../../_generated/server";
import { processQueue } from "../helpers/queueEngine";
import { applyGlobalFilters } from "../helpers/globalFilters";

/**
 * Get smart priority queue - top 5-7 tasks that need attention now
 * Based on overdue items, high priority, and upcoming deadlines
 */
export const getPriorityQueue = query({
  args: {
    include_assigned_to_others: v.optional(v.boolean()),
    max_tasks: v.optional(v.number()),
    target_hours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxTasks = args.max_tasks || 7;
    const includeAssignedToOthers = args.include_assigned_to_others || false;
    
    // Get all active items
    const allItems = await ctx.db
      .query("todoist_items")
      .filter((q) => q.eq(q.field("checked"), 0))
      .filter((q) => q.eq(q.field("is_deleted"), 0))
      .collect();
    
    // Get current user ID for assignee filtering
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;
    
    // Priority queue configuration - focus on urgent and important
    const queueConfig = {
      filters: [
        {
          type: "custom" as const,
          condition: "overdue",
          mode: "include" as const,
        },
        {
          type: "priority" as const,
          minPriority: 2, // P1 and P2 only
          mode: "include" as const,
        },
        {
          type: "date" as const,
          range: "today" as const,
          mode: "include" as const,
        },
        {
          type: "date" as const,
          range: "tomorrow" as const,
          mode: "include" as const,
        },
      ],
      ordering: [
        { field: "priority", direction: "desc" as const },
        { field: "dueDate", direction: "asc" as const, nullsFirst: false },
        { field: "childOrder", direction: "asc" as const },
      ],
      maxTasks,
    };
    
    // Process items through multiple priority segments
    const segments = [
      // Segment 1: Overdue high priority
      {
        ...queueConfig,
        filters: [
          { type: "custom" as const, condition: "overdue" },
          { type: "priority" as const, minPriority: 3 }, // P1, P2, P3
        ],
      },
      // Segment 2: Due today high priority
      {
        ...queueConfig,
        filters: [
          { type: "date" as const, range: "today" as const },
          { type: "priority" as const, minPriority: 2 }, // P1, P2
        ],
      },
      // Segment 3: Due tomorrow P1 only
      {
        ...queueConfig,
        filters: [
          { type: "date" as const, range: "tomorrow" as const },
          { type: "priority" as const, priorities: [4] }, // P1 only (4 is highest)
        ],
      },
    ];
    
    let priorityItems: typeof allItems = [];
    const seenIds = new Set<string>();
    
    // Process each segment until we have enough tasks
    for (const segmentConfig of segments) {
      if (priorityItems.length >= maxTasks) break;
      
      const segmentItems = processQueue(allItems, segmentConfig, userId);
      
      // Add unique items from this segment
      for (const item of segmentItems) {
        if (!seenIds.has(item.todoist_id) && priorityItems.length < maxTasks) {
          priorityItems.push(item);
          seenIds.add(item.todoist_id);
        }
      }
    }
    
    // If we still need more items, add other high-priority items
    if (priorityItems.length < maxTasks) {
      const fillConfig = {
        filters: [
          { type: "priority" as const, minPriority: 2 },
        ],
        ordering: [
          { field: "priority", direction: "desc" as const },
          { field: "dueDate", direction: "asc" as const, nullsFirst: false },
        ],
        maxTasks: maxTasks - priorityItems.length,
      };
      
      const fillItems = processQueue(allItems, fillConfig, userId)
        .filter(item => !seenIds.has(item.todoist_id));
      
      priorityItems.push(...fillItems);
    }
    
    // Apply global filters
    const assigneeFilter = includeAssignedToOthers ? 'all' : 'not-assigned-to-others';
    
    return applyGlobalFilters(priorityItems, {
      assigneeFilter,
      currentUserId: userId,
    });
  },
});