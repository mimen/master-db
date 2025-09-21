import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";

export const upsertNote = internalMutation({
  args: { note: v.any() },
  handler: async (ctx, { note }) => {
    const existing = await ctx.db
      .query("todoist_notes")
      .withIndex("by_todoist_id", (q) => q.eq("todoist_id", note.id))
      .first();

    const noteData = {
      todoist_id: note.id,
      item_id: note.item_id,
      project_id: note.project_id || undefined,
      content: note.content,
      posted_uid: note.posted_uid,
      is_deleted: note.is_deleted ? 1 : 0,
      posted_at: note.posted_at || note.posted || new Date().toISOString(),
      sync_version: note.v || 0,
    };

    if (existing) {
      if (existing.sync_version < noteData.sync_version) {
        await ctx.db.patch(existing._id, noteData);
      }
    } else {
      await ctx.db.insert("todoist_notes", noteData);
    }
  },
});