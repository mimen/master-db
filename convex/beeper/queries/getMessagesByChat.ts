import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { internalQuery } from "../../_generated/server";

/**
 * Messages for one chat, newest first by ts_epoch_ms. Page backwards by
 * passing the previous page's continueCursor.
 */
export const getMessagesByChat = internalQuery({
  args: {
    chat_id: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("beeper_messages")
      .withIndex("by_chat_recent", (q) => q.eq("chat_id", args.chat_id))
      .order("desc")
      .paginate(args.paginationOpts);

    return {
      ...result,
      page: result.page.map((m) => ({
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
      })),
    };
  },
});
