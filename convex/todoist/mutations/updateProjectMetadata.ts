import { v } from "convex/values";

import { mutation } from "../../_generated/server";

export const updateProjectMetadata = mutation({
  args: {
    metadataId: v.id("todoist_project_metadata"),
    updates: v.object({
      project_id: v.string(),
      priority: v.optional(v.union(v.number(), v.null())),
      scheduled_date: v.optional(v.union(v.string(), v.null())),
      description: v.optional(v.union(v.string(), v.null())),
      project_type: v.optional(v.union(
        v.literal("area-of-responsibility"),
        v.literal("project-type"),
        v.null()
      )),
      last_updated: v.number(),
      sync_version: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    // Build the patch object, converting null to undefined to remove fields
    const patchData: any = {
      project_id: args.updates.project_id,
      last_updated: args.updates.last_updated,
      sync_version: args.updates.sync_version,
    };

    // Only include non-null optional fields
    if (args.updates.priority !== null && args.updates.priority !== undefined) {
      patchData.priority = args.updates.priority;
    }
    if (args.updates.scheduled_date !== null && args.updates.scheduled_date !== undefined) {
      patchData.scheduled_date = args.updates.scheduled_date;
    }
    if (args.updates.description !== null && args.updates.description !== undefined) {
      patchData.description = args.updates.description;
    }
    if (args.updates.project_type !== null && args.updates.project_type !== undefined) {
      patchData.project_type = args.updates.project_type;
    }

    await ctx.db.patch(args.metadataId, patchData);
  },
});