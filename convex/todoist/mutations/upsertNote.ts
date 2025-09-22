import { internalMutation } from "../../_generated/server";
import { syncNoteSchema } from "../types/syncApi";

export const upsertNote = internalMutation({
  args: { note: syncNoteSchema },
  handler: async (ctx, { note }) => {
    const existing = await ctx.db
      .query("todoist_notes")
      .withIndex("by_todoist_id", (q) => q.eq("todoist_id", note.id))
      .first();

    // Use timestamp as version since Sync API v1 doesn't provide version field for notes
    const currentVersion = Date.now();
    
    const noteData = {
      todoist_id: note.id,
      item_id: note.item_id,
      project_id: note.project_id || undefined,
      content: note.content,
      posted_uid: note.posted_uid,
      is_deleted: note.is_deleted ? 1 : 0,
      posted_at: note.posted_at,
      sync_version: currentVersion,
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