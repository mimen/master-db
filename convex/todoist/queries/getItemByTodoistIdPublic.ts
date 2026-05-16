import { v } from "convex/values";

import { authedQuery } from "../../_lib/authed";

/**
 * Public query for fetching a Todoist task by its Todoist id.
 * Used by external services (e.g. the agentic engine server).
 */
export default authedQuery({
  args: { todoistId: v.string() },
  handler: async (ctx, { todoistId }) => {
    return ctx.db
      .query("todoist_items")
      .withIndex("by_todoist_id", (q) => q.eq("todoist_id", todoistId))
      .first();
  },
});
