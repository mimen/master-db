import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";

import { computeFlags } from "../../apps/imsg/shared/chat-state";
import { query, type QueryCtx } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";
import {
  attachmentDoc,
  conversationDoc,
  draftDoc,
  messageDoc,
  participant,
  scheduledDoc,
  suggestionDoc,
  syncStateDoc,
  type CommaConversationDoc,
} from "../schema/comma/validators";

import { personForAddress } from "./photos";

const conversationView = v.object({
  ...conversationDoc.fields,
  participants: v.array(v.object({ ...participant.fields, photoUrl: v.optional(v.union(v.string(), v.null())) })),
  flags: v.object({
    unresponded: v.boolean(),
    waiting: v.boolean(),
    unread: v.boolean(),
    mutedUnresponded: v.boolean(),
    pinned: v.boolean(),
  }),
  unreadCount: v.number(),
  groupPhotoUrl: v.union(v.string(), v.null()),
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
  const participants = await Promise.all(conversation.participants.map(async (participant) => {
    const person = await personForAddress(ctx, participant.address);
    return { ...participant, name: person?.display_name ?? participant.name, photoUrl: person?.photoStorageId ? await ctx.storage.getUrl(person.photoStorageId) : null };
  }));
  const displayName = conversation.isGroup
    ? conversation.rawDisplayName === undefined ? conversation.displayName
      : conversation.rawDisplayName.trim() || participants.map((p) => p.name ?? p.address).join(", ")
    : participants[0]?.name ?? conversation.displayName;
  const lastMessage = conversation.lastMessage;
  let senderName = lastMessage?.senderName ?? null;
  if (lastMessage && !lastMessage.isFromMe) {
    const senderAddress = !conversation.isGroup && conversation.participants.length === 1
      ? conversation.participants[0].address
      : (await ctx.db.query("comma_messages").withIndex("by_guid", (q) => q.eq("guid", lastMessage.guid)).unique())?.sender?.address;
    const person = senderAddress ? await personForAddress(ctx, senderAddress) : null;
    senderName = person?.display_name ?? senderName;
  }
  return { ...conversation, displayName, participants, flags, unreadCount,
    ...(lastMessage ? { lastMessage: { ...lastMessage, senderName } } : {}),
    groupPhotoUrl: conversation.groupPhotoStorageId ? await ctx.storage.getUrl(conversation.groupPhotoStorageId) : null,
  };
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
      .filter((q) => q.neq(q.field("lastMessage"), undefined))
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

const attachmentView = v.object({
  ...attachmentDoc.fields,
  thumbUrl: v.union(v.string(), v.null()),
  originalUrl: v.union(v.string(), v.null()),
});

const messageView = v.object({
  ...messageDoc.fields,
  attachments: v.array(attachmentView),
});

export const listMessages = query({
  args: {
    conversationId: v.id("comma_conversations"),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(messageView),
  handler: async (ctx, args) => {
    await assertAllowed(ctx);
    const result = await ctx.db
      .query("comma_messages")
      .withIndex("by_conversation_date", (q) => q.eq("conversationId", args.conversationId))
      .order("desc")
      .filter((q) => q.and(q.eq(q.field("isTapback"), false), q.eq(q.field("retracted"), false)))
      .paginate(args.paginationOpts);
    const page = await Promise.all(result.page.map(async (message) => {
      const attachments = await ctx.db
        .query("comma_attachments")
        .withIndex("by_messageGuid", (q) => q.eq("messageGuid", message.guid))
        .collect();
      const person = message.sender ? await personForAddress(ctx, message.sender.address) : null;
      return {
        ...message,
        ...(message.sender ? { sender: { ...message.sender, name: person?.display_name ?? message.sender.name } } : {}),
        attachments: await Promise.all(attachments.map(async (attachment) => ({
          ...attachment,
          thumbUrl: attachment.thumbStorageId ? await ctx.storage.getUrl(attachment.thumbStorageId) : null,
          originalUrl: attachment.originalStorageId ? await ctx.storage.getUrl(attachment.originalStorageId) : null,
        }))),
      };
    }));
    return { ...result, page };
  },
});

export const searchMessages = query({
  args: { query: v.string(), conversationId: v.optional(v.id("comma_conversations")) },
  returns: v.array(messageDoc),
  handler: async (ctx, args) => {
    await assertAllowed(ctx);
    return await ctx.db
      .query("comma_messages")
      .withSearchIndex("search_text", (q) => {
        const search = q.search("text", args.query).eq("isTapback", false).eq("retracted", false);
        return args.conversationId ? search.eq("conversationId", args.conversationId) : search;
      })
      .take(50);
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

export const listScheduled = query({
  args: {},
  returns: v.array(scheduledDoc),
  handler: async (ctx) => {
    await assertAllowed(ctx);
    return await ctx.db.query("comma_scheduled").withIndex("by_sendAt").order("asc").take(100);
  },
});

export const getDraft = query({
  args: { conversationId: v.id("comma_conversations") },
  returns: v.union(draftDoc, v.null()),
  handler: async (ctx, args) => {
    await assertAllowed(ctx);
    return await ctx.db
      .query("comma_drafts")
      .withIndex("by_conversationId", (q) => q.eq("conversationId", args.conversationId))
      .unique();
  },
});

export const syncStatus = query({
  args: {},
  returns: v.array(syncStateDoc),
  handler: async (ctx) => {
    await assertAllowed(ctx);
    return await ctx.db.query("comma_sync_state").withIndex("by_key").take(100);
  },
});

export const getSuggestions = query({
  args: { conversationId: v.id("comma_conversations") },
  returns: v.union(suggestionDoc, v.null()),
  handler: async (ctx, args) => {
    await assertAllowed(ctx);
    return await ctx.db
      .query("comma_suggestions")
      .withIndex("by_conversationId", (q) => q.eq("conversationId", args.conversationId))
      .unique();
  },
});
