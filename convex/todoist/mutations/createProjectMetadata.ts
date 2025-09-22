import { v } from "convex/values";

import { mutation } from "../../_generated/server";

export const createProjectMetadata = mutation({
  args: {
    project_id: v.string(),
    priority: v.optional(v.number()),
    scheduled_date: v.optional(v.string()),
    description: v.optional(v.string()),
    project_type: v.optional(v.union(
      v.literal("area-of-responsibility"),
      v.literal("project-type")
    )),
    source_task_id: v.optional(v.string()),
    last_updated: v.number(),
    sync_version: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("todoist_project_metadata", args);
  },
});