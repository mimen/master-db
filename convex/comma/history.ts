import { v } from "convex/values";

import { query } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";

import { shownInThread } from "./conversationLookup";
import { listReader, messageView, withMessageAttachments } from "./queries";

export const messageWindow = query({
  args: {
    conversationId: v.string(),
    before: v.optional(v.number()),
    after: v.optional(v.number()),
    around: v.optional(v.number()),
  },
  returns: v.array(messageView),
  handler: async (ctx, args) => {
    await assertAllowed(ctx);
    if ([args.before, args.after, args.around].filter((value) => value !== undefined).length !== 1) {
      throw new Error("Exactly one of before, after, or around must be provided");
    }
    const conversationId = ctx.db.normalizeId("comma_conversations", args.conversationId);
    if (!conversationId) return [];
    const window = (direction: "before" | "after", timestamp: number, inclusive = false) => ctx.db
      .query("comma_messages")
      .withIndex("by_conversation_date", (q) => {
        const range = q.eq("conversationId", conversationId);
        return direction === "after" ? range.gt("dateCreated", timestamp)
          : inclusive ? range.lte("dateCreated", timestamp) : range.lt("dateCreated", timestamp);
      })
      .order(direction === "before" ? "desc" : "asc")
      .filter(shownInThread)
      .take(40);
    // Reverse the descending index result, preserving its creation-time tie order.
    const rows = args.around !== undefined
      ? await Promise.all([window("before", args.around, true), window("after", args.around)])
        .then(([older, newer]) => [...older.reverse(), ...newer])
      : args.before !== undefined ? (await window("before", args.before)).reverse()
        : await window("after", args.after!);
    const read = listReader(ctx);
    return await Promise.all(rows.map((message) => withMessageAttachments(ctx, message, read)));
  },
});
