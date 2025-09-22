import { v } from "convex/values";

import { query } from "../../_generated/server";
import { applyGlobalFilters, type AssigneeFilterType } from "../helpers/globalFilters";

/**
 * Get active Todoist items with global filters applied.
 * Filters out: star prefix tasks, system labels, completed tasks, and applies assignee filtering.
 */
export const getActiveItems = query({
  args: {
    projectId: v.optional(v.string()),
    limit: v.optional(v.number()),
    // UI can override assignee filter
    assigneeFilter: v.optional(
      v.union(
        v.literal('all'),
        v.literal('unassigned'),
        v.literal('assigned-to-me'),
        v.literal('assigned-to-others'),
        v.literal('not-assigned-to-others')
      )
    ),
  },
  handler: async (ctx, args) => {
    // Get raw data directly
    let q = ctx.db
      .query("todoist_items")
      .filter((q) => q.eq(q.field("checked"), 0))
      .filter((q) => q.eq(q.field("is_deleted"), 0));

    if (args.projectId) {
      q = q.filter((q) => q.eq(q.field("project_id"), args.projectId));
    }

    const items = await q.collect();

    // Sort by child_order
    const sortedItems = items.sort((a, b) => a.child_order - b.child_order);

    // Apply limit if specified
    const limitedItems = args.limit && args.limit > 0
      ? sortedItems.slice(0, args.limit)
      : sortedItems;

    // Get current user ID for assignee filtering
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;

    // Use provided filter or default to 'not-assigned-to-others'
    const effectiveAssigneeFilter = args.assigneeFilter as AssigneeFilterType | undefined;

    // Apply global filters
    return applyGlobalFilters(limitedItems, {
      assigneeFilter: effectiveAssigneeFilter,
      currentUserId: userId,
    });
  },
});