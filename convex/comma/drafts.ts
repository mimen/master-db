import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { mutation, type MutationCtx } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";

export async function deleteConversationDraft(ctx: MutationCtx, conversationId: Id<"comma_conversations">): Promise<null> {
  const draft = await ctx.db
    .query("comma_drafts")
    .withIndex("by_conversationId", (q) => q.eq("conversationId", conversationId))
    .unique();
  if (draft) await ctx.db.delete(draft._id);
  return null;
}

export const setDraft = mutation({
  args: { conversationId: v.id("comma_conversations"), text: v.string() },
  returns: v.null(),
  handler: async (ctx, { conversationId, text }) => {
    await assertAllowed(ctx);
    if (!text) return await deleteConversationDraft(ctx, conversationId);
    const draft = await ctx.db
      .query("comma_drafts")
      .withIndex("by_conversationId", (q) => q.eq("conversationId", conversationId))
      .unique();
    const updatedAt = Date.now();
    if (draft) await ctx.db.patch(draft._id, { text, updatedAt });
    else await ctx.db.insert("comma_drafts", { conversationId, text, updatedAt });
    return null;
  },
});

export const clearDraft = mutation({
  args: { conversationId: v.id("comma_conversations") },
  returns: v.null(),
  handler: async (ctx, { conversationId }) => {
    await assertAllowed(ctx);
    return await deleteConversationDraft(ctx, conversationId);
  },
});
