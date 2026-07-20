import { v } from "convex/values";

import { query } from "../../_generated/server";

/**
 * Most-recently-active chats, optionally filtered to a single network.
 *
 * Backed by the `by_network_activity` / `by_last_activity` indexes so the
 * usual "show me my recent chats" panel is a single index walk.
 */
export const getRecentChats = query({
  args: {
    network: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    const rows = args.network
      ? await ctx.db
          .query("beeper_chats")
          .withIndex("by_network_activity", (q) =>
            q.eq("network", args.network!),
          )
          .order("desc")
          .take(limit)
      : await ctx.db
          .query("beeper_chats")
          .withIndex("by_last_activity")
          .order("desc")
          .take(limit);

    return rows.map((c) => ({
      _id: c._id,
      chat_id: c.chat_id,
      title: c.title,
      type: c.type,
      network: c.network,
      participant_count: c.participant_count,
      last_activity: c.last_activity,
      unread_count: c.unread_count,
      message_count: c.message_count,
    }));
  },
});
