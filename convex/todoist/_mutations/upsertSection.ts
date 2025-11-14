import { internalMutation } from "../../_generated/server";
import { syncSectionSchema } from "../types/syncApi";

export const upsertSection = internalMutation({
  args: { section: syncSectionSchema },
  handler: async (ctx, { section }) => {
    const existing = await ctx.db
      .query("todoist_sections")
      .withIndex("by_todoist_id", (q) => q.eq("todoist_id", section.id))
      .first();

    // Use a combination of fields as version since Sync API v1 doesn't provide version field
    const currentVersion = Date.now();

    const sectionData = {
      todoist_id: section.id,
      name: section.name,
      project_id: section.project_id,
      section_order: section.section_order || 0,
      collapsed: section.collapsed,
      is_deleted: Boolean(section.is_deleted), // Convert to boolean
      is_archived: Boolean(section.is_archived), // Convert to boolean
      sync_version: currentVersion,
    };

    if (existing) {
      if (existing.sync_version < sectionData.sync_version) {
        await ctx.db.patch(existing._id, sectionData);
      }
    } else {
      await ctx.db.insert("todoist_sections", sectionData);
    }
  },
});