import { v } from "convex/values";

import { internalQuery } from "../../../_generated/server";

/**
 * Internal query that returns raw active items without any filters.
 * Used by sync operations and as a base for filtered public queries.
 */
export const getRawActiveItems = internalQuery({
  args: {
    projectId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let q = ctx.db
      .query("todoist_items")
      .filter((q) => q.eq(q.field("checked"), false))
      .filter((q) => q.eq(q.field("is_deleted"), false));

    if (args.projectId) {
      q = q.filter((q) => q.eq(q.field("project_id"), args.projectId));
    }

    const items = await q.collect();

    // Sort by child_order
    const sortedItems = items.sort((a, b) => a.child_order - b.child_order);

    // Apply limit if specified
    if (args.limit && args.limit > 0) {
      return sortedItems.slice(0, args.limit);
    }

    return sortedItems;
  },
});