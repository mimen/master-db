import { v } from "convex/values";

import { query } from "../../_generated/server";

/**
 * Full-text search across all Beeper messages.
 *
 * Backed by the `search_text` Convex search index on `beeper_messages.text`.
 * Filters by network / chat_id / sender_id are pushed into the index when
 * provided.
 */
export const searchMessages = query({
  args: {
    query: v.string(),
    network: v.optional(v.string()),
    chat_id: v.optional(v.string()),
    sender_id: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    const results = await ctx.db
      .query("beeper_messages")
      .withSearchIndex("search_text", (q) => {
        let qq = q.search("text", args.query);
        if (args.network) qq = qq.eq("network", args.network);
        if (args.chat_id) qq = qq.eq("chat_id", args.chat_id);
        if (args.sender_id) qq = qq.eq("sender_id", args.sender_id);
        return qq;
      })
      .take(limit);

    return results.map((m) => ({
      _id: m._id,
      chat_id: m.chat_id,
      message_id: m.message_id,
      network: m.network,
      sender_name: m.sender_name,
      timestamp: m.timestamp,
      type: m.type,
      text: m.text,
      is_sender: m.is_sender,
      has_attachments: (m.attachments?.length ?? 0) > 0,
    }));
  },
});
