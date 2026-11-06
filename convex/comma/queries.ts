import { paginationOptsValidator, paginationResultValidator, type SearchFilterFinalizer } from "convex/server";
import { v } from "convex/values";

import { formatAddress } from "../../apps/imsg/shared/address";
import { conversationFlags } from "../../apps/imsg/shared/chat-state";
import type { Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";
import { groupCrm } from "../identity/groupCrm";
import { personName } from "../identity/names";
import {
  attachmentDoc,
  conversationCrmView,
  conversationDoc,
  draftListItem,
  draftView,
  messageDoc,
  participant,
  scheduledDoc,
  suggestionDoc,
  syncStateDoc,
  type CommaConversationDoc,
  type CommaMessageDoc,
} from "../schema/comma/validators";

import { findByChatGuid } from "./conversationLookup";
import { resolveConversationNames } from "./names";
import { normalizedAddress, personForNormalized } from "./photos";

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
  /** A participant resolves to a named person in the identity graph. */
  known: v.boolean(),
  /** False while the identity graph holds no Apple contacts, so the Unknown lens fails open. */
  contactsAvailable: v.boolean(),
  /** Every name the participants' people go by, for conversation search. */
  searchNames: v.array(v.string()),
  groupPhotoUrl: v.union(v.string(), v.null()),
  crm: v.optional(conversationCrmView),
});

/** Reads the same CRM ChatSummary.crm carries: groups own theirs, a DM inherits its person's. */
async function conversationCrm(
  ctx: QueryCtx,
  conversation: CommaConversationDoc,
  person: Awaited<ReturnType<typeof personForNormalized>>,
  read: ListReader,
) {
  let base: { is_favorite?: boolean; priority?: number; tags: string[] };
  if (conversation.isGroup) {
    const [crm, tags] = await Promise.all([groupCrm.crm(ctx, conversation), groupCrm.tags(ctx, conversation)]);
    base = { is_favorite: crm?.is_favorite, priority: crm?.priority, tags: tags.map((t) => t.tag) };
  } else if (person) {
    const tags = await read.personTags(person._id);
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

function memo<K, V>(load: (key: K) => Promise<V>) {
  const cache = new Map<K, Promise<V>>();
  return (key: K) => {
    let value = cache.get(key);
    if (!value) {
      value = load(key);
      cache.set(key, value);
    }
    return value;
  };
}

// Shares in-flight lookups within one query execution, never across reactive executions.
// Keys are what the read depends on: a "+1… (smsfp)" sender and a "+1…" participant share
// one identity lookup, and a person reached by phone and by email is read once.
export function listReader(ctx: QueryCtx) {
  const getPerson = memo((id: Id<"people">) => ctx.db.get(id));
  const personByNormalized = memo((normalized: string) => personForNormalized(ctx, normalized, getPerson));
  let contactsAvailable: Promise<boolean> | undefined;
  return {
    person: (address: string) => personByNormalized(normalizedAddress(address)),
    contactsAvailable: () => contactsAvailable ??= ctx.db.query("identities")
      .withIndex("by_source_contact", (q) => q.eq("source", "apple_contact")).first().then((row) => row !== null),
    personTags: memo((id: Id<"people">) => ctx.db.query("tags").withIndex("by_person", (q) => q.eq("person_id", id)).collect()),
    storageUrl: memo((id: Id<"_storage">) => ctx.storage.getUrl(id)),
  };
}
type ListReader = ReturnType<typeof listReader>;

export async function withConversationState(
  ctx: QueryCtx,
  conversation: CommaConversationDoc,
  read = listReader(ctx),
) {
  const state = await ctx.db
    .query("comma_conversation_state")
    .withIndex("by_conversationId", (q) => q.eq("conversationId", conversation._id))
    .unique();
  // A mark-read in Comma lands here before chat.db catches up.
  const { flags, unreadCount } = conversationFlags(state ?? undefined, conversation.lastMessage ?? null,
    conversation.lastMessageAt, conversation.unread?.count ?? 0);
  const people = await Promise.all(conversation.participants.map((participant) => read.person(participant.address)));
  const names = resolveConversationNames(conversation, people);
  const participants = await Promise.all(names.participants.map(async (participant, index) => {
    const person = people[index];
    return { ...participant, photoUrl: person?.photoStorageId ? await read.storageUrl(person.photoStorageId) : null };
  }));
  const crm = await conversationCrm(ctx, conversation, !conversation.isGroup && people.length === 1 ? people[0] ?? null : null, read);
  const lastMessage = conversation.lastMessage;
  let senderName = lastMessage?.senderName ?? null;
  if (lastMessage && !lastMessage.isFromMe) {
    const senderAddress = !conversation.isGroup && conversation.participants.length === 1
      ? conversation.participants[0].address
      : (await ctx.db.query("comma_messages").withIndex("by_guid", (q) => q.eq("guid", lastMessage.guid)).unique())?.sender?.address;
    if (senderAddress) senderName = personName(await read.person(senderAddress)) ?? formatAddress(senderAddress);
  }
  return { ...conversation, displayName: names.displayName, participants, flags, unreadCount, ...(crm ? { crm } : {}),
    known: names.known, contactsAvailable: await read.contactsAvailable(), searchNames: names.searchNames,
    ...(lastMessage ? { lastMessage: { ...lastMessage, senderName } } : {}),
    groupPhotoUrl: conversation.groupPhotoStorageId ? await read.storageUrl(conversation.groupPhotoStorageId) : null,
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
    const read = listReader(ctx);
    return {
      ...result,
      page: await Promise.all(result.page.map((conversation) => withConversationState(ctx, conversation, read))),
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

/** A message with its sender and reaction names read from the identity graph, not the names stored on the row. */
async function withSenderNames(message: CommaMessageDoc, read: ListReader): Promise<CommaMessageDoc> {
  const nameOf = async (address: string) => personName(await read.person(address));
  return {
    ...message,
    ...(message.sender ? { sender: { ...message.sender, name: await nameOf(message.sender.address) } } : {}),
    reactions: await Promise.all(message.reactions.map(async (reaction) =>
      ({ ...reaction, senderName: reaction.senderAddress ? await nameOf(reaction.senderAddress) : null }))),
  };
}

export async function withMessageAttachments(ctx: QueryCtx, message: CommaMessageDoc, read = listReader(ctx)) {
  const attachments = await ctx.db
    .query("comma_attachments")
    .withIndex("by_messageGuid", (q) => q.eq("messageGuid", message.guid))
    .filter((q) => q.eq(q.field("hideAttachment"), false))
    .collect();
  return {
    ...await withSenderNames(message, read),
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
    const read = listReader(ctx);
    const page = await Promise.all(result.page.map((message) => withMessageAttachments(ctx, message, read)));
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
    const read = listReader(ctx);
    return await Promise.all((await searchMessageRows(ctx, args)).map((message) => withSenderNames(message, read)));
  },
});

export async function searchMessageRows(ctx: QueryCtx, args: {
  query: string; conversationId?: Id<"comma_conversations">; from?: "me" | "them";
}): Promise<CommaMessageDoc[]> {
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
}

export const resolveChat = query({
  args: { chatGuid: v.string() },
  returns: v.union(conversationView, v.null()),
  handler: async (ctx, args) => {
    await assertAllowed(ctx);
    const conversation = await findByChatGuid(ctx, args.chatGuid);
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
  returns: v.union(draftView, v.null()),
  handler: async (ctx, args) => {
    await assertAllowed(ctx);
    const draft = await ctx.db
      .query("comma_drafts")
      .withIndex("by_conversationId", (q) => q.eq("conversationId", args.conversationId))
      .unique();
    if (!draft) return null;
    const { attachments, ...rest } = draft;
    if (!attachments) return rest;
    return { ...rest, attachments: await Promise.all(attachments.map(async (a) => ({ ...a, url: await ctx.storage.getUrl(a.storageId) }))) };
  },
});

/** The Drafts lens: every conversation with something in its composer, newest first. */
export const listDrafts = query({
  args: {},
  returns: v.array(draftListItem),
  handler: async (ctx) => {
    await assertAllowed(ctx);
    // ponytail: newest 200 drafts; paginate if a larger backlog ever matters.
    const drafts = await ctx.db.query("comma_drafts").withIndex("by_updatedAt").order("desc").take(200);
    return drafts.map((d) => ({
      conversationId: d.conversationId, text: d.text, updatedAt: d.updatedAt, source: d.source ?? "user",
      ...(d.note !== undefined ? { note: d.note } : {}), attachmentCount: d.attachments?.length ?? 0,
    }));
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
