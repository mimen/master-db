import { v, type Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type QueryCtx } from "../_generated/server";
import { commandMessage } from "../schema/comma/validators";
import { people } from "../schema/identity/people";

import { conversationPeople } from "./conversationInfo";
import { resolveConversationNames } from "./names";
import { searchMessageRows } from "./queries";

/**
 * Thread reads for the agent runner, reached through the bridge ingest routes. They are
 * mutations only because the ingest route runs mutations; none of them write.
 */

const nullableString = v.union(v.string(), v.null());
const agentMessage = v.object({
  guid: v.string(), at: v.number(), fromMe: v.boolean(), sender: v.string(), text: v.string(),
  attachments: v.array(v.object({ guid: v.string(), name: nullableString, mime: nullableString })),
});
type AgentMessage = Infer<typeof agentMessage>;

async function requireConversation(ctx: QueryCtx, conversationId: Id<"comma_conversations">) {
  const conversation = await ctx.db.get(conversationId);
  if (!conversation) throw new Error("Conversation not found");
  return conversation;
}

async function participantsOf(ctx: QueryCtx, conversation: Doc<"comma_conversations">) {
  return (await conversationPeople(ctx, conversation)).map((participant) => ({
    ...participant,
    handles: [...new Set([participant.address, ...participant.person?.normalized_phones ?? [], ...participant.person?.normalized_emails ?? []])],
  }));
}

async function attachmentFor(ctx: QueryCtx, guid: string) {
  return await ctx.db.query("comma_attachments").withIndex("by_guid", (q) => q.eq("guid", guid)).unique();
}

async function messageViews(ctx: QueryCtx, participants: { address: string; name: string }[], rows: Doc<"comma_messages">[]): Promise<AgentMessage[]> {
  const names = new Map(participants.map(({ address, name }) => [address, name]));
  return await Promise.all(rows.map(async (message) => ({
    guid: message.guid, at: message.dateCreated, fromMe: message.isFromMe, text: message.text,
    sender: message.isFromMe ? "Me" : names.get(message.sender?.address ?? "") ?? message.sender?.name ?? message.sender?.address ?? "Unknown",
    attachments: await Promise.all(message.attachmentGuids.map(async (guid) => {
      const attachment = await attachmentFor(ctx, guid);
      return { guid, name: attachment?.transferName ?? attachment?.filename ?? null, mime: attachment?.mimeType ?? null };
    })),
  })));
}

/** Newest-last messages, the newest `limit` of those between the optional bounds (both exclusive). */
export const agentContext = internalMutation({
  args: {
    conversationId: v.id("comma_conversations"),
    sinceMessageAt: v.optional(v.number()),
    beforeMessageAt: v.optional(v.number()),
    limit: v.number(),
  },
  returns: v.object({
    title: v.string(),
    participants: v.array(v.object({ name: v.string(), handles: v.array(v.string()) })),
    messages: v.array(agentMessage),
  }),
  handler: async (ctx, { conversationId, sinceMessageAt, beforeMessageAt, limit }) => {
    if (!Number.isInteger(limit) || limit < 1 || limit > 400) throw new Error("limit must be between 1 and 400");
    const conversation = await requireConversation(ctx, conversationId);
    const rows = await ctx.db.query("comma_messages")
      .withIndex("by_conversation_date", (q) => {
        const scoped = q.eq("conversationId", conversationId);
        const after = sinceMessageAt === undefined ? scoped : scoped.gt("dateCreated", sinceMessageAt);
        return beforeMessageAt === undefined ? after : after.lt("dateCreated", beforeMessageAt);
      })
      .order("desc")
      .filter((q) => q.and(q.eq(q.field("isTapback"), false), q.eq(q.field("retracted"), false)))
      .take(limit);
    const participants = await participantsOf(ctx, conversation);
    return {
      title: resolveConversationNames(conversation, participants.map(({ person }) => person)).displayName,
      participants: participants.map(({ name, handles }) => ({ name, handles })),
      messages: await messageViews(ctx, participants, rows.reverse()),
    };
  },
});

/**
 * The AI lane's thread: the newest 60 messages as the wire Message, with folded reactions and attachment kinds,
 * and participants named the way every client names them. `name` is null for someone with no known name.
 */
export const aiThread = internalMutation({
  args: { conversationId: v.id("comma_conversations") },
  returns: v.object({
    title: v.string(),
    isGroup: v.boolean(),
    participants: v.array(v.object({ address: v.string(), name: nullableString })),
    messages: v.array(commandMessage),
  }),
  handler: async (ctx, { conversationId }) => {
    const conversation = await requireConversation(ctx, conversationId);
    const rows = await ctx.db.query("comma_messages")
      .withIndex("by_conversation_date", (q) => q.eq("conversationId", conversationId))
      .order("desc")
      .filter((q) => q.and(q.eq(q.field("isTapback"), false), q.eq(q.field("retracted"), false)))
      .take(60);
    const named = resolveConversationNames(conversation, (await conversationPeople(ctx, conversation)).map(({ person }) => person));
    const participants = named.participants.map(({ address, name }) => ({ address, name }));
    const names = new Map(participants.map(({ address, name }) => [address, name]));
    const messages = await Promise.all(rows.reverse().map(async (row) => ({
      guid: row.guid, chatGuid: row.chatGuid, text: row.text, dateCreated: row.dateCreated,
      dateRead: row.dateRead ?? null, dateDelivered: row.dateDelivered ?? null, isFromMe: row.isFromMe, service: row.service,
      sender: row.sender ? { address: row.sender.address, name: names.get(row.sender.address) ?? row.sender.name } : null,
      attachments: (await Promise.all(row.attachmentGuids.map((guid) => attachmentFor(ctx, guid)))).flatMap((a) => a ? [{
        guid: a.guid, mimeType: a.mimeType ?? null, filename: a.transferName ?? a.filename ?? null,
        width: a.width ?? null, height: a.height ?? null, totalBytes: a.totalBytes ?? null,
      }] : []),
      mentions: row.mentions, special: row.special ?? null, sendEffect: row.sendEffect ?? null, reactions: row.reactions,
      replyToGuid: row.replyToGuid ?? null, replyToPreview: row.replyToPreview ?? null, replyToFromMe: row.replyToFromMe ?? null,
      isGroupEvent: row.isGroupEvent, error: row.error, edited: row.edited, retracted: row.retracted,
    })));
    return { title: named.displayName, isGroup: conversation.isGroup, participants, messages };
  },
});

export const agentSearch = internalMutation({
  args: { conversationId: v.id("comma_conversations"), query: v.string() },
  returns: v.array(agentMessage),
  handler: async (ctx, { conversationId, query }) => {
    const participants = await conversationPeople(ctx, await requireConversation(ctx, conversationId));
    return await messageViews(ctx, participants, await searchMessageRows(ctx, { conversationId, query }));
  },
});

const { notes, is_favorite, priority, organization } = people.validator.fields;
export const agentPeople = internalMutation({
  args: { conversationId: v.id("comma_conversations") },
  returns: v.array(v.object({
    address: v.string(), name: v.string(), handles: v.array(v.string()), personId: v.optional(v.id("people")),
    notes, is_favorite, priority, organization,
    tags: v.array(v.string()),
    events: v.array(v.object({ airtable_event_id: v.string(), event_name: v.string(), start_date: v.optional(v.string()) })),
  })),
  handler: async (ctx, { conversationId }) => {
    const conversation = await requireConversation(ctx, conversationId);
    return await Promise.all((await participantsOf(ctx, conversation)).map(async ({ address, name, handles, person }) => {
      if (!person) return { address, name, handles, tags: [], events: [] };
      const tags = await ctx.db.query("tags").withIndex("by_person", (q) => q.eq("person_id", person._id)).collect();
      const events = await ctx.db.query("event_links").withIndex("by_person", (q) => q.eq("person_id", person._id)).collect();
      return {
        address, name, handles, personId: person._id, notes: person.notes, is_favorite: person.is_favorite,
        priority: person.priority, organization: person.organization, tags: tags.map(({ tag }) => tag),
        events: events.map(({ airtable_event_id, event_name, start_date }) => ({ airtable_event_id, event_name, start_date })),
      };
    }));
  },
});

export const agentAttachment = internalMutation({
  args: { guid: v.string() },
  returns: v.union(v.null(), v.object({ url: nullableString, name: nullableString, mime: nullableString })),
  handler: async (ctx, { guid }) => {
    const attachment = await attachmentFor(ctx, guid);
    if (!attachment) return null;
    return {
      url: attachment.originalStorageId ? await ctx.storage.getUrl(attachment.originalStorageId) : null,
      name: attachment.transferName ?? attachment.filename ?? null,
      mime: attachment.mimeType ?? null,
    };
  },
});
