import { paginationOptsValidator, paginationResultValidator, type SearchFilterFinalizer } from "convex/server";
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
  type CommaMessageDoc,
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
  /** The private CRM layer: a group's own row, a DM's person. Absent when nothing is set. */
  crm: v.optional(v.object({
    is_favorite: v.optional(v.boolean()),
    priority: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
  })),
});

/** Reads the same CRM ChatSummary.crm carries: groups own theirs, a DM inherits its person's. */
async function conversationCrm(
  ctx: QueryCtx,
  conversation: CommaConversationDoc,
  person: Awaited<ReturnType<typeof personForAddress>>,
) {
  let base: { is_favorite?: boolean; priority?: number; tags: string[] };
  if (conversation.isGroup) {
    const row = await ctx.db.query("chat_crm")
      .withIndex("by_chat_guid", (q) => q.eq("chat_guid", conversation.primaryChatGuid)).first();
    const tags = await ctx.db.query("tags")
      .withIndex("by_chat", (q) => q.eq("chat_guid", conversation.primaryChatGuid)).collect();
    base = { is_favorite: row?.is_favorite, priority: row?.priority, tags: tags.map((t) => t.tag) };
  } else if (person) {
    const tags = await ctx.db.query("tags").withIndex("by_person", (q) => q.eq("person_id", person._id)).collect();
    base = {
      is_favorite: person.is_favorite,
      priority: typeof person.priority === "number" ? person.priority : undefined,
      tags: tags.map((t) => t.tag),
    };
  } else {
    return undefined;
  }
  if (!base.is_favorite && base.priority === undefined && base.tags.length === 0) return undefined;
  return {
    ...(base.is_favorite ? { is_favorite: true } : {}),
    ...(base.priority !== undefined ? { priority: base.priority } : {}),
    ...(base.tags.length > 0 ? { tags: base.tags.sort() } : {}),
  };
}

function personReader(ctx: QueryCtx) {
  // Share in-flight lookups within one query, never across reactive executions.
  const people = new Map<string, ReturnType<typeof personForAddress>>();
  return (address: string) => {
    let person = people.get(address);
    if (!person) {
      person = personForAddress(ctx, address);
      people.set(address, person);
    }
    return person;
  };
}

async function withConversationState(
  ctx: QueryCtx,
  conversation: CommaConversationDoc,
  readPerson = personReader(ctx),
) {
  const state = await ctx.db
    .query("comma_conversation_state")
    .withIndex("by_conversationId", (q) => q.eq("conversationId", conversation._id))
    .unique();
  // A mark-read in Comma lands here before chat.db catches up.
  const unreadCount = (state?.readAt ?? 0) >= conversation.lastMessageAt ? 0 : conversation.unread?.count ?? 0;
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
  const people = await Promise.all(conversation.participants.map((participant) => readPerson(participant.address)));
  const participants = await Promise.all(conversation.participants.map(async (participant, index) => {
    const person = people[index];
    return { ...participant, name: person?.display_name ?? participant.name, photoUrl: person?.photoStorageId ? await ctx.storage.getUrl(person.photoStorageId) : null };
  }));
  const crm = await conversationCrm(ctx, conversation, !conversation.isGroup && people.length === 1 ? people[0] ?? null : null);
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
    const person = senderAddress ? await readPerson(senderAddress) : null;
    senderName = person?.display_name ?? senderName;
  }
  return { ...conversation, displayName, participants, flags, unreadCount, ...(crm ? { crm } : {}),
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
    const readPerson = personReader(ctx);
    return {
      ...result,
      page: await Promise.all(result.page.map((conversation) => withConversationState(ctx, conversation, readPerson))),
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

export const messageView = v.object({
  ...messageDoc.fields,
  attachments: v.array(attachmentView),
});

export async function withMessageAttachments(ctx: QueryCtx, message: CommaMessageDoc) {
  const attachments = await ctx.db
    .query("comma_attachments")
    .withIndex("by_messageGuid", (q) => q.eq("messageGuid", message.guid))
    .filter((q) => q.eq(q.field("hideAttachment"), false))
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
}

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
    const page = await Promise.all(result.page.map((message) => withMessageAttachments(ctx, message)));
    return { ...result, page };
  },
});

export const searchMessages = query({
  args: {
    query: v.string(),
    conversationId: v.optional(v.id("comma_conversations")),
    from: v.optional(v.union(v.literal("me"), v.literal("them"))),
  },
  returns: v.array(messageDoc),
  handler: async (ctx, args) => {
    await assertAllowed(ctx);
    return await ctx.db
      .query("comma_messages")
      .withSearchIndex("search_text", (q) => {
        let search = q.search("text", args.query).eq("isTapback", false).eq("retracted", false);
        if (args.conversationId) search = search.eq("conversationId", args.conversationId);
        // The sibling schema branch adds isFromMe to search_text.filterFields.
        if (args.from) {
          const senderSearch = search as SearchFilterFinalizer<CommaMessageDoc, {
            searchField: "text";
            filterFields: "conversationId" | "isTapback" | "retracted" | "isFromMe";
          }>;
          return senderSearch.eq("isFromMe", args.from === "me");
        }
        return search;
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
