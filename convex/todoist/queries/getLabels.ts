import { query } from "../../_generated/server";

/**
 * Get all active labels
 */
export const getLabels = query({
  handler: async (ctx) => {
    const labels = await ctx.db
      .query("todoist_labels")
      .filter((q) => q.eq(q.field("is_deleted"), false))
      .order("asc")
      .collect();

    return labels;
  },
});