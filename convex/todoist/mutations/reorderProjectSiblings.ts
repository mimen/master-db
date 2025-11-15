import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { internalMutation } from "../../_generated/server";

/**
 * Recalculate and normalize child_order for all siblings under a parent
 * Ensures sequential ordering: 0, 1, 2, 3...
 *
 * This is called after moving a project to ensure consistency.
 * Todoist API may handle this automatically, but we ensure our local DB is correct.
 */
export const reorderProjectSiblings = internalMutation({
  args: {
    parentId: v.union(v.string(), v.null()), // null = root level projects
  },
  handler: async (ctx, { parentId }) => {
    // Get all projects with this parent, ordered by current child_order
    const siblings = await ctx.db
      .query("todoist_projects")
      .filter((q) =>
        parentId === null
          ? q.eq(q.field("parent_id"), null)
          : q.eq(q.field("parent_id"), parentId)
      )
      .collect();

    // Sort by current child_order
    siblings.sort((a, b) => (a.child_order || 0) - (b.child_order || 0));

    // Update each sibling with normalized child_order (0, 1, 2, 3...)
    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];
      if (sibling.child_order !== i) {
        await ctx.db.patch(sibling._id, {
          child_order: i,
        });
      }
    }

    return { reordered: siblings.length };
  },
});
