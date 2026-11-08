import { v, type Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type QueryCtx } from "../_generated/server";
import { commandMessage, modelTextFields, platform, route } from "../schema/comma/validators";
import { people } from "../schema/identity/people";

import { soleAccountScope } from "./accounts";
import { imessageCapabilities } from "./bridgeState";
import { sendRoute } from "./conversationIdentity";
import { conversationPeople } from "./conversationInfo";
import { findAttachment, findMessage, shownInThread } from "./conversationLookup";
import { attachmentName, isAssociated, messageImessage, modelTextFieldsOf, scopeOf, type AccountScope } from "./messageShape";
import { resolveConversationNames } from "./names";
import { personContext, personContextResult } from "./personContext";
import { summaryText } from "./personSummaries";
import { normalizedAddress, personForAddress } from "./photos";
import { searchMessageRows } from "./queries";
import { reactionsOf } from "./reactionStore";

/**
 * Thread reads for the agent runner, reached through the bridge ingest routes. They are
 * mutations only because the ingest route runs mutations; none of them write.
 */

const nullableString = v.union(v.string(), v.null());
const agentMessage = v.object({
  guid: v.string(), at: v.number(), fromMe: v.boolean(), sender: v.string(), text: v.string(), ...modelTextFields,
  /** The replied-to message's preview. */
  replyTo: v.optional(v.string()),
  /** What a body-less payload is, such as "[location]". */
  placeholder: v.optional(v.string()),
  attachments: v.array(v.object({ guid: v.string(), name: nullableString, mime: nullableString })),
  /** `reaction` is the emoji, or the platform's name for a reaction without one. */
  reactions: v.array(v.object({ reaction: v.string(), fromMe: v.boolean(), sender: v.string() })),
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

/** The runner names an attachment by its iMessage guid alone. */
const IMESSAGE_ANY: AccountScope = { platform: "imessage", accountId: null };

async function messageViews(ctx: QueryCtx, participants: { address: string; name: string }[], rows: Doc<"comma_messages">[]): Promise<AgentMessage[]> {
  const names = new Map(participants.map(({ address, name }) => [address, name]));
  return await Promise.all(rows.map(async (message) => ({
    guid: message.guid, at: message.dateCreated, fromMe: message.isFromMe, text: message.text, ...modelTextFieldsOf(message),
    ...(message.replyToPreview ? { replyTo: message.replyToPreview } : {}),
    ...placeholderOf(message),
    sender: message.isFromMe ? "Me" : names.get(message.sender?.address ?? "") ?? message.sender?.name ?? message.sender?.address ?? "Unknown",
    attachments: await Promise.all(message.attachmentGuids.map(async (guid) => {
      const attachment = await findAttachment(ctx, scopeOf(message), guid);
      return { guid, name: (attachment && attachmentName(attachment)) ?? null, mime: attachment?.mimeType ?? null };
    })),
    reactions: (await reactionsOf(ctx, message)).map((reaction) => ({
      reaction: reaction.emoji ?? reaction.key, fromMe: reaction.isFromMe,
      sender: reaction.isFromMe ? "Me" : names.get(reaction.senderAddress ?? "") ?? reaction.senderAddress ?? "Unknown",
    })),
  })));
}

function placeholderOf(row: Doc<"comma_messages">): { placeholder?: string } {
  const special = messageImessage(row)?.special;
  return special ? { placeholder: `[${special.kind}]` } : {};
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
      .filter(shownInThread)
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
 * The AI lane's thread: the newest 60 messages as the wire Message with their model text, folded reactions and
 * attachment kinds, participants named the way every client names them (`name` is null for someone with no known
 * name) with their person's emails, the route a reply takes, and what that route's executor can send now.
 */
export const aiThread = internalMutation({
  args: { conversationId: v.id("comma_conversations") },
  returns: v.object({
    title: v.string(),
    isGroup: v.boolean(),
    participants: v.array(v.object({ address: v.string(), name: nullableString, emails: v.array(v.string()) })),
    route,
    messages: v.array(v.object({ ...commandMessage.fields, ...modelTextFields })),
    /** The route's Mac's BlueBubbles, from its executor status; nothing before it reports. */
    bridge: v.object({ privateApi: v.boolean(), emojiReactions: v.boolean() }),
  }),
  handler: async (ctx, { conversationId }) => {
    const conversation = await requireConversation(ctx, conversationId);
    const rows = await ctx.db.query("comma_messages")
      .withIndex("by_conversation_date", (q) => q.eq("conversationId", conversationId))
      .order("desc")
      .filter(shownInThread)
      .take(60);
    const people = (await conversationPeople(ctx, conversation)).map(({ person }) => person);
    const named = resolveConversationNames(conversation, people);
    const participants = named.participants.map(({ address, name }, index) => ({ address, name, emails: people[index]?.normalized_emails ?? [] }));
    const names = new Map(participants.map(({ address, name }) => [address, name]));
    const messages = await Promise.all(rows.reverse().map(async (row) => {
      // ponytail: the AI thread is iMessage's flat wire message; a second platform's rows need a neutral one.
      const imessage = messageImessage(row);
      return {
        guid: row.guid, chatGuid: imessage?.chatGuid ?? conversation.primaryChatGuid ?? "", text: row.text, ...modelTextFieldsOf(row), dateCreated: row.dateCreated,
        dateRead: row.dateRead ?? null, dateDelivered: row.dateDelivered ?? null, isFromMe: row.isFromMe, service: imessage?.service ?? "iMessage",
        sender: row.sender ? { address: row.sender.address, name: names.get(row.sender.address) ?? row.sender.name } : null,
        attachments: (await Promise.all(row.attachmentGuids.map((guid) => findAttachment(ctx, scopeOf(row), guid)))).flatMap((a) => a ? [{
          guid: a.guid, mimeType: a.mimeType ?? null, filename: attachmentName(a) ?? null,
          width: a.width ?? null, height: a.height ?? null, totalBytes: a.totalBytes ?? null,
        }] : []),
        mentions: row.mentions, special: imessage?.special ?? null, sendEffect: imessage?.sendEffect ?? null,
        reactions: (await reactionsOf(ctx, row)).map((reaction) =>
          ({ ...reaction, senderName: reaction.senderAddress ? names.get(reaction.senderAddress) ?? null : null })),
        replyToGuid: row.replyToGuid ?? null, replyToPreview: row.replyToPreview ?? null, replyToFromMe: row.replyToFromMe ?? null,
        isGroupEvent: row.isGroupEvent, error: imessage?.error ?? 0, edited: row.edited, retracted: row.retracted,
      };
    }));
    const route = sendRoute(conversation);
    const bridge = await imessageCapabilities(ctx, route);
    return { title: named.displayName, isGroup: conversation.isGroup, participants, route, messages,
      bridge: { privateApi: bridge?.privateApi ?? false, emojiReactions: bridge?.emojiReactions ?? false } };
  },
});

const SENT_SAMPLE = 200;

/**
 * An account's newest sent texts, the sample its reply voice is derived from: the route's account, else the platform's
 * only one. Rows from before accounts count as the platform's, and the oldest iMessage rows carry no platform at all.
 */
export const aiSentText = internalMutation({
  args: { platform, accountId: v.optional(v.id("comma_accounts")) },
  returns: v.array(v.string()),
  handler: async (ctx, { platform: name, accountId: routed }) => {
    const accountId = routed ?? (await soleAccountScope(ctx, name)).accountId ?? undefined;
    const sent = (scoped: typeof name | undefined, account: typeof accountId) => ctx.db.query("comma_messages")
      .withIndex("by_platform_account_fromMe_date", (q) => q.eq("platform", scoped).eq("accountId", account).eq("isFromMe", true))
      .order("desc").take(SENT_SAMPLE);
    // ponytail: three ranges of SENT_SAMPLE rows each; the two legacy ones go once the accounts backfill has run.
    const ranges = await Promise.all([
      ...accountId ? [sent(name, accountId)] : [],
      sent(name, undefined),
      ...name === "imessage" ? [sent(undefined, undefined)] : [],
    ]);
    return ranges.flat()
      .filter((row) => !row.retracted && !row.sendState && !isAssociated(row))
      .sort((a, b) => b.dateCreated - a.dateCreated)
      .slice(0, SENT_SAMPLE)
      .map((row) => (row.modelText ?? row.text).trim())
      .filter((text) => text.length >= 2 && text.length <= 500);
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

/**
 * A person's messages in every other conversation, newest first. The person is `personId`, else whoever `address`
 * resolves to, else the one person of this conversation; null for a group named with neither. The person must be a
 * participant of this conversation.
 */
export const agentPersonContext = internalMutation({
  args: {
    conversationId: v.id("comma_conversations"),
    personId: v.optional(v.id("people")),
    address: v.optional(v.string()),
    sinceAt: v.optional(v.number()),
    beforeAt: v.optional(v.number()),
    limit: v.number(),
    maxChars: v.number(),
  },
  returns: v.union(personContextResult, v.null()),
  handler: async (ctx, { conversationId, personId, address: named, sinceAt, beforeAt, limit, maxChars }) => {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("limit must be between 1 and 100");
    if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > 20_000) throw new Error("maxChars must be between 1 and 20000");
    if (personId && named !== undefined) throw new Error("Pass at most one of personId, address");
    const conversation = await requireConversation(ctx, conversationId);
    const address = named ?? (personId || conversation.isGroup ? undefined : conversation.participants[0]?.address);
    if (!personId && address === undefined) return null;
    let person = personId ? await ctx.db.get(personId) : await personForAddress(ctx, address!);
    if (personId && !person) throw new Error("Person not found");
    for (let hops = 0; person?.merged_into && hops < 5; hops++) person = await ctx.db.get(person.merged_into);
    const participants = await conversationPeople(ctx, conversation);
    const personInThread = person?._id;
    const inThread = personInThread
      ? participants.some((participant) => participant.person?._id === personInThread)
      : participants.some((participant) => normalizedAddress(participant.address) === normalizedAddress(address!));
    if (!inThread) throw new Error("That person is not in this conversation");
    const summary = sinceAt === undefined && beforeAt === undefined ? await summaryText(ctx, person?._id) : undefined;
    return { ...await personContext(ctx, { person, address, excludeConversationId: conversationId, sinceAt, beforeAt, limit, maxChars }), ...(summary ? { summary } : {}) };
  },
});

const { notes, is_favorite, priority, organization } = people.validator.fields;
export const agentPeople = internalMutation({
  args: { conversationId: v.id("comma_conversations") },
  returns: v.array(v.object({
    address: v.string(), name: v.string(), handles: v.array(v.string()), personId: v.optional(v.id("people")),
    notes, is_favorite, priority, organization,
    /** Their written summary across platforms, when one has been built. */
    summary: v.optional(v.string()),
    tags: v.array(v.string()),
    events: v.array(v.object({ airtable_event_id: v.string(), event_name: v.string(), start_date: v.optional(v.string()) })),
  })),
  handler: async (ctx, { conversationId }) => {
    const conversation = await requireConversation(ctx, conversationId);
    return await Promise.all((await participantsOf(ctx, conversation)).map(async ({ address, name, handles, person }) => {
      if (!person) return { address, name, handles, tags: [], events: [] };
      const tags = await ctx.db.query("tags").withIndex("by_person", (q) => q.eq("person_id", person._id)).collect();
      const events = await ctx.db.query("event_links").withIndex("by_person", (q) => q.eq("person_id", person._id)).collect();
      const summary = await summaryText(ctx, person._id);
      return {
        address, name, handles, personId: person._id, notes: person.notes, is_favorite: person.is_favorite, ...(summary ? { summary } : {}),
        priority: person.priority, organization: person.organization, tags: tags.map(({ tag }) => tag),
        events: events.map(({ airtable_event_id, event_name, start_date }) => ({ airtable_event_id, event_name, start_date })),
      };
    }));
  },
});

/** An attachment of a message in `conversationId`; null for any other conversation's. */
export const agentAttachment = internalMutation({
  args: { conversationId: v.id("comma_conversations"), guid: v.string() },
  returns: v.union(v.null(), v.object({ url: nullableString, name: nullableString, mime: nullableString })),
  handler: async (ctx, { conversationId, guid }) => {
    const attachment = await findAttachment(ctx, IMESSAGE_ANY, guid);
    if (!attachment) return null;
    const message = await findMessage(ctx, scopeOf(attachment), attachment.messageGuid);
    if (message?.conversationId !== conversationId) return null;
    return {
      url: attachment.originalStorageId ? await ctx.storage.getUrl(attachment.originalStorageId) : null,
      name: attachmentName(attachment) ?? null,
      mime: attachment.mimeType ?? null,
    };
  },
});
