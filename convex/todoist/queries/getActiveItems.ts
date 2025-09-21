import { v } from "convex/values";

import { query } from "../../_generated/server";

export const getActiveItems = query({
  args: {
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let q = ctx.db
      .query("todoist_items")
      .filter((q) => q.eq(q.field("checked"), 0));

    if (args.projectId) {
      q = q.filter((q) => q.eq(q.field("project_id"), args.projectId));
    }

    const items = await q.collect();

    // Sort by child_order
    return items.sort((a, b) => a.child_order - b.child_order);
  },
});