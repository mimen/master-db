import { query } from "../../_generated/server";
import { SYSTEM_EXCLUDED_LABELS } from "../helpers/globalFilters";

/**
 * Get all active labels, excluding system labels
 */
export const getLabels = query({
  handler: async (ctx) => {
    const labels = await ctx.db
      .query("todoist_labels")
      .filter((q) => q.eq(q.field("is_deleted"), false))
      .order("asc")
      .collect();

    // Filter out system excluded labels
    return labels.filter(label => !SYSTEM_EXCLUDED_LABELS.includes(label.name as typeof SYSTEM_EXCLUDED_LABELS[number]));
  },
});