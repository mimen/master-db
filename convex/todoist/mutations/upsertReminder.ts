import { v } from "convex/values";

import { internalMutation } from "../../_generated/server";

export const upsertReminder = internalMutation({
  args: { reminder: v.any() },
  handler: async (ctx, { reminder }) => {
    const existing = await ctx.db
      .query("todoist_reminders")
      .withIndex("by_todoist_id", (q) => q.eq("todoist_id", reminder.id))
      .first();

    const reminderData = {
      todoist_id: reminder.id,
      item_id: reminder.item_id,
      type: reminder.type,
      due: reminder.due,
      mm_offset: reminder.mm_offset || undefined,
      is_deleted: reminder.is_deleted ? 1 : 0,
      sync_version: reminder.v || 0,
    };

    if (existing) {
      if (existing.sync_version < reminderData.sync_version) {
        await ctx.db.patch(existing._id, reminderData);
      }
    } else {
      await ctx.db.insert("todoist_reminders", reminderData);
    }
  },
});