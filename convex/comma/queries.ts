import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";

import { computeFlags } from "../../apps/imsg/shared/chat-state";
import { query, type QueryCtx } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";
import { conversationDoc, type CommaConversationDoc } from "../schema/comma/validators";

const conversationView = v.object({
  ...conversationDoc.fields,
  flags: v.object({
    unresponded: v.boolean(),
    waiting: v.boolean(),
    unread: v.boolean(),
    mutedUnresponded: v.boolean(),
    pinned: v.boolean(),
  }),
  unreadCount: v.number(),
});

async function withConversationState(ctx: QueryCtx, conversation: CommaConversationDoc) {
  const state = await ctx.db
    .query("comma_conversation_state")
    .withIndex("by_conversationId", (q) => q.eq("conversationId", conversation._id))
    .unique();
  // TODO: Mirror the bridge's unread count instead of scanning message history on every inbox read.
  const unreadCount = 0;
  const flags = computeFlags(
    state ? {
      chatGuid: conversation.primaryChatGuid,
      dismissedUnrespondedGuid: state.dismissedUnrespondedGuid ?? null,
      dismissedWaitingGuid: state.dismissedWaitingGuid ?? null,
      mutedUnresponded: Number(state.mutedUnresponded),
      markedUnread: Number(state.markedUnread),
      pinned: Number(state.pinned),
      readAt: state.readAt,
    } : undefined,
    conversation.lastMessage ?? null,
    unreadCount,
  );
  return { ...conversation, flags, unreadCount };
}

export const listConversations = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(conversationView),
  handler: async (ctx, args) => {
    await assertAllowed(ctx);
    const result = await ctx.db
      .query("comma_conversations")
      .withIndex("by_lastMessageAt")
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(result.page.map((conversation) => withConversationState(ctx, conversation))),
    };
  },
});

export const getConversation = query({
  args: { conversationId: v.id("comma_conversations") },
  returns: v.union(conversationView, v.null()),
  handler: async (ctx, args) => {
    await assertAllowed(ctx);
    const conversation = await ctx.db.get(args.conversationId);
    return conversation ? await withConversationState(ctx, conversation) : null;
  },
});

export const resolveChat = query({
  args: { chatGuid: v.string() },
  returns: v.union(conversationView, v.null()),
  handler: async (ctx, args) => {
    await assertAllowed(ctx);
    const alias = await ctx.db
      .query("comma_chat_aliases")
      .withIndex("by_chatGuid", (q) => q.eq("chatGuid", args.chatGuid))
      .unique();
    const conversation = alias ? await ctx.db.get(alias.conversationId) : null;
    return conversation ? await withConversationState(ctx, conversation) : null;
  },
});
