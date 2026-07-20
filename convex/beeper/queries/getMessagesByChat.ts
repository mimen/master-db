import { v } from "convex/values";

import { query } from "../../_generated/server";

/**
 * Messages for one chat, ordered by ts_epoch_ms. Default newest-first.
 *
 * For pagination, callers pass `before_ts_epoch_ms` (the oldest ts they have)
 * and we return the next page going backwards.
 */
export const getMessagesByChat = query({
  args: {
    chat_id: v.string(),
    before_ts_epoch_ms: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;

    const before = args.before_ts_epoch_ms;
    const rows = await ctx.db
      .query("beeper_messages")
      .withIndex("by_chat_recent", (q) =>
        before !== undefined
          ? q.eq("chat_id", args.chat_id).lt("ts_epoch_ms", before)
          : q.eq("chat_id", args.chat_id),
      )
      .order("desc")
      .take(limit);

    return rows.map((m) => ({
      _id: m._id,
      message_id: m.message_id,
      sender_id: m.sender_id,
      sender_name: m.sender_name,
      is_sender: m.is_sender,
      timestamp: m.timestamp,
      ts_epoch_ms: m.ts_epoch_ms,
      type: m.type,
      text: m.text,
      reactions: m.reactions,
      attachments: m.attachments,
      reply_to_message_id: m.reply_to_message_id,
      is_deleted: m.is_deleted,
    }));
  },
});
