import { v } from "convex/values";

import { query } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";

import { messageView, withMessageAttachments } from "./queries";

export const messageWindow = query({
  args: {
    conversationId: v.id("comma_conversations"),
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
    const window = (direction: "before" | "after", timestamp: number, inclusive = false) => ctx.db
      .query("comma_messages")
      .withIndex("by_conversation_date", (q) => {
        const range = q.eq("conversationId", args.conversationId);
        return direction === "after" ? range.gt("dateCreated", timestamp)
          : inclusive ? range.lte("dateCreated", timestamp) : range.lt("dateCreated", timestamp);
      })
      .order(direction === "before" ? "desc" : "asc")
      .filter((q) => q.and(q.eq(q.field("isTapback"), false), q.eq(q.field("retracted"), false)))
      .take(40);
    // Reverse the descending index result, preserving its creation-time tie order.
    const rows = args.around !== undefined
      ? await Promise.all([window("before", args.around, true), window("after", args.around)])
        .then(([older, newer]) => [...older.reverse(), ...newer])
      : args.before !== undefined ? (await window("before", args.before)).reverse()
        : await window("after", args.after!);
    return await Promise.all(rows.map((message) => withMessageAttachments(ctx, message)));
  },
});
