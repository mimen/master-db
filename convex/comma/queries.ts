import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v, type Infer } from "convex/values";

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
  conversationKind as conversationKindValidator,
  draftListItem,
  draftView,
  messageDoc,
  participant,
  platform as platformValidator,
  reaction,
  scheduledDoc,
  suggestionDoc,
  syncStateDoc,
  type CommaConversationDoc,
  type CommaMessageDoc,
  type CommaPlatform,
} from "../schema/comma/validators";

import { soleAccountScope } from "./accounts";
import { conversationKind, slack } from "./conversationIdentity";
import { findByChatGuid, findByKey, findMessage, shownInThread } from "./conversationLookup";
import { attachmentRead, messageRead as readMessage, scopeOf } from "./messageShape";
import { resolveConversationNames } from "./names";
import { normalizedAddress, personForNormalized } from "./photos";
import { reactionsOf } from "./reactionStore";

const conversationView = v.object({
  ...conversationDoc.fields,
  kind: conversationKindValidator,
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
  /** A Slack thread's: the DM, group DM or channel Comma holds it in, and how many replies it has. */
  thread: v.optional(v.object({ parentId: v.optional(v.id("comma_conversations")), replyCount: v.number() })),
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

/** chat.db's count for iMessage; Gmail's UNREAD labels for email. Slack reports no read state to Comma. */
export const unreadOf = (conversation: CommaConversationDoc): number => conversation.unread?.count ?? conversation.gmail?.unread ?? 0;

export async function withConversationState(
  ctx: QueryCtx,
  conversation: CommaConversationDoc,
  read = listReader(ctx),
) {
  const state = await ctx.db
    .query("comma_conversation_state")
    .withIndex("by_conversationId", (q) => q.eq("conversationId", conversation._id))
    .unique();
  const ruled = { platform: conversation.platform ?? "imessage", kind: conversationKind(conversation), following: conversation.slack?.following };
  // A mark-read in Comma lands here before chat.db catches up.
  const { flags, unreadCount } = conversationFlags(ruled, state ?? undefined, conversation.lastMessage ?? null,
    conversation.lastMessageAt, unreadOf(conversation));
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
      : (await findMessage(ctx, scopeOf(conversation), lastMessage.guid))?.sender?.address;
    if (senderAddress) senderName = personName(await read.person(senderAddress)) ?? formatAddress(senderAddress);
  }
  return { ...conversation, kind: ruled.kind, displayName: names.displayName, participants, flags, unreadCount, ...(crm ? { crm } : {}),
    known: names.known, contactsAvailable: await read.contactsAvailable(), searchNames: names.searchNames,
    ...(lastMessage ? { lastMessage: { ...lastMessage, senderName } } : {}),
    groupPhotoUrl: conversation.groupPhotoStorageId ? await read.storageUrl(conversation.groupPhotoStorageId) : null,
    ...(ruled.kind === "thread" ? { thread: await threadSummary(ctx, conversation) } : {}),
  };
}

async function threadSummary(ctx: QueryCtx, conversation: CommaConversationDoc) {
  const { channel, threadTs } = conversation.slack!;
  const scope = scopeOf(conversation);
  const parents = await Promise.all(slack.parentKeys(channel).map((key) => findByKey(ctx, scope, key)));
  const parent = parents.find((row) => row !== null);
  const root = await findMessage(ctx, scope, slack.messageGuid(channel, threadTs!));
  return { ...(parent ? { parentId: parent._id } : {}), replyCount: root?.replyCount ?? 0 };
}

/**
 * A Slack thread is part of its DM, group DM or channel, so the list shows it only while it wants Milad: owed a reply,
 * marked unread, or pinned. A thread he doesn't follow is its channel's alone and costs the list no read; one he
 * follows reads only its triage state to decide.
 */
async function listed(ctx: QueryCtx, conversation: CommaConversationDoc): Promise<boolean> {
  if (!conversation.slack?.threadTs) return true;
  if (conversation.slack.following === false) return false;
  const state = await ctx.db.query("comma_conversation_state")
    .withIndex("by_conversationId", (q) => q.eq("conversationId", conversation._id)).unique();
  const { flags } = conversationFlags({ platform: "slack", kind: "thread", following: conversation.slack.following }, state ?? undefined,
    conversation.lastMessage ?? null, conversation.lastMessageAt, unreadOf(conversation));
  return flags.unresponded || flags.unread || flags.pinned;
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
      // Email threads list in the Mail workspace, not in Messages.
      .filter((q) => q.and(q.neq(q.field("lastMessage"), undefined), q.neq(q.field("kind"), "emailThread")))
      .paginate(args.paginationOpts);
    const read = listReader(ctx);
    const shown = (await Promise.all(result.page.map(async (conversation) => (await listed(ctx, conversation) ? conversation : null))))
      .filter((conversation) => conversation !== null);
    return {
      ...result,
      page: await Promise.all(shown.map((conversation) => withConversationState(ctx, conversation, read))),
    };
  },
});

/** The Mail workspace: email threads in the inbox, newest first. Its People lens is a filter over these on the client. */
export const listEmailThreads = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(conversationView),
  handler: async (ctx, args) => {
    await assertAllowed(ctx);
    const result = await ctx.db
      .query("comma_conversations")
      .withIndex("by_kind_lastMessageAt", (q) => q.eq("kind", "emailThread"))
      .order("desc")
      .filter((q) => q.and(q.neq(q.field("lastMessage"), undefined), q.eq(q.field("gmail.inInbox"), true)))
      .paginate(args.paginationOpts);
    const read = listReader(ctx);
    return { ...result, page: await Promise.all(result.page.map((conversation) => withConversationState(ctx, conversation, read))) };
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

/**
 * A stored message as clients read it: its iMessage fields under `imessage` and, for clients built before that,
 * flat as well; `reactions` is the merged reaction list, not the row's legacy fold.
 */
export const messageRead = v.object({
  ...messageDoc.fields,
  reactions: v.array(reaction),
});

export const messageView = v.object({
  ...messageRead.fields,
  attachments: v.array(attachmentView),
  /** A Slack message that starts a thread Comma holds: that thread's conversation. */
  thread: v.optional(v.object({ conversationId: v.id("comma_conversations"), replyCount: v.number() })),
});

/** A message with its reactions, and sender and reaction names read from the identity graph, not the names stored on the row. */
async function withSenderNames(ctx: QueryCtx, message: CommaMessageDoc, read: ListReader): Promise<Infer<typeof messageRead>> {
  const nameOf = async (address: string) => personName(await read.person(address));
  return {
    ...readMessage(message),
    ...(message.sender ? { sender: { ...message.sender, name: await nameOf(message.sender.address) } } : {}),
    reactions: await Promise.all((await reactionsOf(ctx, message)).map(async (reaction) =>
      ({ ...reaction, senderName: reaction.senderAddress ? await nameOf(reaction.senderAddress) : null }))),
  };
}

export async function withMessageAttachments(ctx: QueryCtx, message: CommaMessageDoc, read = listReader(ctx)) {
  const attachments = await ctx.db
    .query("comma_attachments")
    .withIndex("by_messageGuid", (q) => q.eq("messageGuid", message.guid))
    .filter((q) => q.and(q.eq(q.field("hideAttachment"), false), q.eq(q.field("conversationId"), message.conversationId)))
    .collect();
  return {
    ...await withSenderNames(ctx, message, read),
    attachments: await Promise.all(attachments.map(async (attachment) => ({
      ...attachmentRead(attachment),
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
      .filter(shownInThread)
      .paginate(args.paginationOpts);
    const conversation = await ctx.db.get(args.conversationId);
    const thread = conversation?.slack?.threadTs ? conversation.slack : null;
    const rootGuid = thread ? slack.messageGuid(thread.channel, thread.threadTs!) : null;
    // A thread's root lives in its channel or DM; the thread shows it first, under its replies' last page.
    const root = result.isDone && conversation && rootGuid && !result.page.some((message) => message.guid === rootGuid)
      ? await findMessage(ctx, scopeOf(conversation), rootGuid) : null;
    const read = listReader(ctx);
    const page = await Promise.all([...result.page, ...(root && !root.retracted ? [root] : [])].map(async (message) => {
      const view = await withMessageAttachments(ctx, message, read);
      if (!message.replyCount || message.guid === rootGuid || !conversation) return view;
      const threadConversation = await findByKey(ctx, scopeOf(conversation),
        slack.conversationKey({ type: "thread", channel: conversation.slack!.channel, threadTs: message.guid.slice(conversation.slack!.channel.length + 1) }));
      return threadConversation ? { ...view, thread: { conversationId: threadConversation._id, replyCount: message.replyCount } } : view;
    }));
    return { ...result, page };
  },
});

export const searchMessages = query({
  args: {
    query: v.string(),
    conversationId: v.optional(v.id("comma_conversations")),
    from: v.optional(v.union(v.literal("me"), v.literal("them"))),
    platform: v.optional(platformValidator),
  },
  returns: v.array(messageRead),
  handler: async (ctx, args) => {
    await assertAllowed(ctx);
    const read = listReader(ctx);
    return await Promise.all((await searchMessageRows(ctx, args)).map((message) => withSenderNames(ctx, message, read)));
  },
});

/** Associated messages are filtered after the search: rows written since the side object carry no isTapback to match. */
export async function searchMessageRows(ctx: QueryCtx, args: {
  query: string; conversationId?: Id<"comma_conversations">; from?: "me" | "them"; platform?: CommaPlatform;
}): Promise<CommaMessageDoc[]> {
  return await ctx.db
    .query("comma_messages")
    .withSearchIndex("search_text", (q) => {
      let search = q.search("text", args.query).eq("retracted", false);
      if (args.conversationId) search = search.eq("conversationId", args.conversationId);
      if (args.from) search = search.eq("isFromMe", args.from === "me");
      // Messages from before platforms carry none and are all iMessage's, so iMessage filters by leaving the others out.
      if (args.platform && args.platform !== "imessage") search = search.eq("platform", args.platform);
      return search;
    })
    .filter((q) => q.and(q.neq(q.field("isTapback"), true), q.neq(q.field("imessage.isAssociatedMessage"), true),
      args.platform === "imessage" ? q.and(q.neq(q.field("platform"), "slack"), q.neq(q.field("platform"), "gmail")) : true))
    .take(50);
}

export const resolveChat = query({
  args: { chatGuid: v.string() },
  returns: v.union(conversationView, v.null()),
  handler: async (ctx, args) => {
    await assertAllowed(ctx);
    const conversation = await findByChatGuid(ctx, await soleAccountScope(ctx, "imessage"), args.chatGuid);
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
