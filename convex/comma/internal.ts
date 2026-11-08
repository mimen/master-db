import { v } from "convex/values";

import { isPendingGuid } from "../../apps/imsg/shared/pending-send";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import {
  attachmentInput,
  lastMessageSummary,
  legacyAttachmentInput,
  legacyMessageInput,
  messageInput,
  participant,
  platform,
  scheduledStatus,
  suggestionFields,
} from "../schema/comma/validators";

import { ingestAccount, isSelf } from "./accounts";
import { imessage, isGroupKind, PLATFORM_IDENTITY } from "./conversationIdentity";
import { findAlias, findAttachment, findByChatGuid, findByKey, findMessage } from "./conversationLookup";
import { FLAT_ATTACHMENT_UNSET, FLAT_MESSAGE_UNSET, inScope, MODEL_TEXT_UNSET, postedAttachment, postedMessage, type AccountScope } from "./messageShape";
import { landEcho, refreshLastMessage } from "./pendingSends";
import { fromTapback } from "./reactions";
import { applyReaction } from "./reactionStore";
import { schedulePrecompute } from "./suggestions";
import { logReplies } from "./triage";

/**
 * Bridge write path for the Comma mirror. The bridge on the Mini calls these
 * through the /comma/ingest/* HTTP routes. Every function is idempotent: a
 * replayed batch leaves the same rows.
 *
 * Batch limits: keep calls at or under 200 messages or attachments. A Convex
 * mutation may write 8,192 documents and read 16,384, and each message write
 * can also touch its conversation and its reactions.
 *
 * A tapback the bridge posts as a message row is a reaction: it lands in comma_reactions and
 * leaves no message row.
 *
 * Each batch names its platform and account (`ingestScope`). A bridge built before accounts names
 * neither and writes for the iMessage account.
 */

/** The platform and account a batch writes for. Both are optional for bridges built before accounts. */
const ingestScope = { platform: v.optional(platform), accountId: v.optional(v.id("comma_accounts")) };

function scopeFor(account: Doc<"comma_accounts">): AccountScope & { accountId: Id<"comma_accounts"> } {
  return { platform: account.platform, accountId: account._id };
}

/** Structural equality over Convex values, ignoring object key order. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = (o: object) => Object.keys(o).filter((k) => (o as Record<string, unknown>)[k] !== undefined);
  const ka = keys(a), kb = keys(b);
  return ka.length === kb.length && ka.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function sameFields<T extends object>(existing: T, fields: Partial<T>): boolean {
  return Object.entries(fields).every(([key, value]) => sameValue(existing[key as keyof T], value));
}

const conversationInput = v.object({
  conversationKey: v.string(),
  chats: v.array(v.object({ chatGuid: v.string(), lastMessageAt: v.number() })),
  displayName: v.string(),
  rawDisplayName: v.optional(v.string()),
  isGroup: v.boolean(),
  participants: v.array(participant),
  isSpam: v.boolean(),
  hasGroupPhoto: v.boolean(),
  lastMessage: v.optional(lastMessageSummary),
  lastMessageAt: v.number(),
});

export const upsertConversations = internalMutation({
  args: { ...ingestScope, conversations: v.array(conversationInput) },
  returns: v.record(v.string(), v.id("comma_conversations")),
  handler: async (ctx, { conversations, ...named }) => {
    const account = await ingestAccount(ctx, named);
    const scope = scopeFor(account);
    // Chats and their aliases are iMessage's; another platform writes its conversations from its own ingest.
    const resolved: Record<string, Id<"comma_conversations">> = {};
    const now = Date.now();
    for (const input of conversations) {
      const primaryChatGuid = imessage.choosePrimary(input.chats);
      const chatGuids = input.chats.map((chat) => chat.chatGuid).sort();
      let existing = await findByKey(ctx, scope, input.conversationKey);
      if (!existing) {
        for (const chatGuid of chatGuids) {
          const candidate = await findByChatGuid(ctx, scope, chatGuid);
          if (candidate && imessage.conversationKey(candidate) === input.conversationKey) {
            existing = candidate;
            break;
          }
        }
      }
      const kind = imessage.kind(input);
      const fields = {
        platform: account.platform,
        accountId: account._id,
        conversationKey: input.conversationKey,
        primaryChatGuid,
        chatGuids,
        displayName: input.displayName,
        rawDisplayName: input.rawDisplayName,
        kind,
        isGroup: isGroupKind(kind),
        participants: input.participants,
        isSpam: input.isSpam,
        hasGroupPhoto: input.hasGroupPhoto,
        // Messages keep lastMessage current; a conversation snapshot only fills a gap.
        lastMessage: existing?.lastMessage ?? input.lastMessage,
        lastMessageAt: Math.max(existing?.lastMessageAt ?? 0, input.lastMessageAt),
      };
      const conversationId = existing ? existing._id : await ctx.db.insert("comma_conversations", { ...fields, updatedAt: now });
      // The bridge re-sends every chat each reconcile. An unchanged row must not be written:
      // any write re-runs every live conversation-list page that read it.
      if (existing && !sameFields(existing, fields)) {
        await ctx.db.patch(existing._id, { ...fields, updatedAt: now });
      }

      for (const chatGuid of chatGuids) {
        const alias = await findAlias(ctx, scope, chatGuid);
        if (!alias) {
          await ctx.db.insert("comma_chat_aliases", {
            platform: account.platform, accountId: account._id, chatGuid, conversationId, service: imessage.service(chatGuid),
          });
        } else if (alias.conversationId !== conversationId || alias.accountId !== account._id) {
          await ctx.db.patch(alias._id, { conversationId, platform: account.platform, accountId: account._id });
        }
        resolved[chatGuid] = conversationId;
      }
    }
    return resolved;
  },
});

export const upsertMessages = internalMutation({
  args: { ...ingestScope, messages: v.array(v.union(messageInput, legacyMessageInput)) },
  returns: v.object({ written: v.number(), skipped: v.number() }),
  handler: async (ctx, { messages, ...named }) => {
    const account = await ingestAccount(ctx, named);
    const scope = scopeFor(account);
    let written = 0;
    let skipped = 0;
    const touchedConversations = new Set<Id<"comma_conversations">>();
    const real: Pick<Doc<"comma_messages">, "conversationId" | "guid" | "dateCreated" | "isFromMe">[] = [];
    for (const posted of messages) {
      const { imessage: { tapback, ...imessage }, ...core } = postedMessage(posted);
      const message = {
        ...core, platform: account.platform, accountId: account._id, imessage,
        isFromMe: core.isFromMe || (!PLATFORM_IDENTITY[account.platform].reportsFromMe && isSelf(account, core.sender?.address)),
        mentionsMe: core.mentions.some((mention) => isSelf(account, mention.address)),
      };
      const existing = await findMessage(ctx, scope, message.guid);
      if (existing && existing.sourceVersion >= message.sourceVersion) {
        skipped++;
        continue;
      }
      const reaction = fromTapback({ ...message, tapback });
      if (reaction) {
        if (await applyReaction(ctx, reaction)) written++;
        else skipped++;
        continue;
      }
      if (existing) await ctx.db.patch(existing._id, { ...MODEL_TEXT_UNSET, ...message, ...FLAT_MESSAGE_UNSET });
      else await ctx.db.insert("comma_messages", message);
      await landEcho(ctx, message);
      written++;
      if (!isPendingGuid(message.guid) && !imessage.isAssociatedMessage && !message.retracted) real.push(message);
      touchedConversations.add(message.conversationId);
    }
    for (const conversationId of touchedConversations) await refreshLastMessage(ctx, conversationId);
    await logReplies(ctx, real);
    await schedulePrecompute(ctx, real);
    return { written, skipped };
  },
});

export const upsertAttachments = internalMutation({
  args: { ...ingestScope, attachments: v.array(v.union(attachmentInput, legacyAttachmentInput)) },
  returns: v.object({ written: v.number(), skipped: v.number() }),
  handler: async (ctx, { attachments, ...named }) => {
    const account = await ingestAccount(ctx, named);
    const scope = scopeFor(account);
    let written = 0;
    let skipped = 0;
    for (const posted of attachments) {
      const attachment = { ...postedAttachment(posted), platform: account.platform, accountId: account._id };
      const existing = await findAttachment(ctx, scope, attachment.guid);
      if (existing && existing.sourceVersion >= attachment.sourceVersion) {
        skipped++;
        continue;
      }
      // Storage ids and transcripts are attached later by other writers; keep them.
      const row = {
        ...attachment,
        thumbStorageId: attachment.thumbStorageId ?? existing?.thumbStorageId,
        originalStorageId: attachment.originalStorageId ?? existing?.originalStorageId,
        transcript: attachment.transcript ?? existing?.transcript,
      };
      if (existing) await ctx.db.patch(existing._id, { ...row, ...FLAT_ATTACHMENT_UNSET });
      else await ctx.db.insert("comma_attachments", row);
      written++;
    }
    return { written, skipped };
  },
});

/** The bridge's media and transcript writes name an attachment by its iMessage guid alone. */
const BRIDGE_MEDIA_SCOPE: AccountScope = { platform: "imessage", accountId: null };

export const setAttachmentStorage = internalMutation({
  args: {
    guid: v.string(),
    thumbStorageId: v.optional(v.id("_storage")),
    originalStorageId: v.optional(v.id("_storage")),
  },
  returns: v.boolean(),
  handler: async (ctx, { guid, thumbStorageId, originalStorageId }) => {
    const attachment = await findAttachment(ctx, BRIDGE_MEDIA_SCOPE, guid);
    if (!attachment) return false;
    await ctx.db.patch(attachment._id, {
      ...(thumbStorageId ? { thumbStorageId } : {}),
      ...(originalStorageId ? { originalStorageId } : {}),
    });
    return true;
  },
});

export const setTranscript = internalMutation({
  args: { attachmentGuid: v.string(), transcript: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { attachmentGuid, transcript }) => {
    const attachment = await findAttachment(ctx, BRIDGE_MEDIA_SCOPE, attachmentGuid);
    if (!attachment) return false;
    await ctx.db.patch(attachment._id, { transcript });
    return true;
  },
});

/**
 * Replaces the posting account's scheduled messages with one snapshot. Another account's rows are not the
 * snapshot's to delete.
 */
export const replaceScheduled = internalMutation({
  args: {
    ...ingestScope,
    items: v.array(
      v.object({
        bbId: v.number(),
        chatGuid: v.string(),
        text: v.string(),
        sendAt: v.number(),
        status: scheduledStatus,
        error: v.optional(v.string()),
        sentAt: v.optional(v.number()),
      }),
    ),
  },
  returns: v.object({ upserted: v.number(), deleted: v.number() }),
  handler: async (ctx, { items, ...named }) => {
    const account = await ingestAccount(ctx, named);
    const scope = scopeFor(account);
    const now = Date.now();
    const keep = new Set(items.map((item) => item.bbId));
    let deleted = 0;
    for (const row of await ctx.db.query("comma_scheduled").collect()) {
      // A row Comma schedules itself has no bbId and is not BlueBubbles' to delete.
      if (inScope(row, scope) && row.bbId !== undefined && !keep.has(row.bbId)) {
        await ctx.db.delete(row._id);
        deleted++;
      }
    }
    for (const item of items) {
      const conversationId = (await findAlias(ctx, scope, item.chatGuid))?.conversationId;
      const existing = (await ctx.db
        .query("comma_scheduled")
        .withIndex("by_bbId", (q) => q.eq("bbId", item.bbId))
        .collect()).find((row) => inScope(row, scope));
      const row = { ...item, platform: account.platform, accountId: account._id, conversationId, updatedAt: now };
      if (existing) await ctx.db.patch(existing._id, row);
      else await ctx.db.insert("comma_scheduled", row);
    }
    return { upserted: items.length, deleted };
  },
});

/** Replaces the posting account's unread state with one snapshot; another account's conversations keep theirs. */
export const replaceUnread = internalMutation({
  args: { ...ingestScope, chats: v.array(v.object({ chatGuid: v.string(), count: v.number(), firstAt: v.number() })) },
  returns: v.object({ changed: v.number(), unresolved: v.number() }),
  handler: async (ctx, { chats, ...named }) => {
    const scope = scopeFor(await ingestAccount(ctx, named));
    const next = new Map<Id<"comma_conversations">, { count: number; firstAt: number }>();
    let unresolved = 0;
    for (const chat of chats) {
      const id = (await findAlias(ctx, scope, chat.chatGuid))?.conversationId;
      if (!id) {
        unresolved++;
        continue;
      }
      const prior = next.get(id);
      next.set(id, { count: (prior?.count ?? 0) + chat.count, firstAt: Math.min(prior?.firstAt ?? chat.firstAt, chat.firstAt) });
    }
    let changed = 0;
    // Only rows unread now or unread next can change; a full scan cost a second on every arrival.
    const unread = (await ctx.db.query("comma_conversations")
      .withIndex("by_unreadCount", (q) => q.gt("unread.count", -1)).collect()).filter((row) => inScope(row, scope));
    const seen = new Set(unread.map((row) => row._id));
    const added = await Promise.all([...next.keys()].filter((id) => !seen.has(id)).map((id) => ctx.db.get(id)));
    for (const conversation of [...unread, ...added]) {
      if (!conversation) continue;
      const want = next.get(conversation._id);
      if (want?.count === conversation.unread?.count && want?.firstAt === conversation.unread?.firstAt) continue;
      await ctx.db.patch(conversation._id, { unread: want });
      changed++;
    }
    return { changed, unresolved };
  },
});

/** A bridge's cursor row, per account. iMessage's rows from before accounts carry none and are adopted. */
export const markSyncState = internalMutation({
  args: {
    ...ingestScope,
    key: v.string(),
    cursor: v.optional(v.string()),
    lastEventAt: v.optional(v.number()),
    lastReconcileAt: v.optional(v.number()),
    counts: v.optional(v.record(v.string(), v.number())),
  },
  returns: v.null(),
  handler: async (ctx, { platform, accountId, ...args }) => {
    const account = await ingestAccount(ctx, { platform, accountId });
    const existing = await ctx.db
      .query("comma_sync_state")
      .withIndex("by_account_key", (q) => q.eq("accountId", account._id).eq("key", args.key))
      .unique() ?? (account.platform === "imessage" ? await ctx.db
      .query("comma_sync_state")
      .withIndex("by_account_key", (q) => q.eq("accountId", undefined).eq("key", args.key))
      .unique() : null);
    const updatedAt = Date.now();
    if (existing) await ctx.db.patch(existing._id, { ...args, accountId: account._id, updatedAt });
    else await ctx.db.insert("comma_sync_state", { ...args, accountId: account._id, updatedAt });
    return null;
  },
});

/**
 * One-off repair for conversations duplicated by a key change (e.g. a short
 * code first keyed as fake E.164). For each pair of conversations sharing a
 * chatGuid, keeps the older document id, moves every dependent row onto it,
 * adopts the newer key, and deletes the newer document.
 */
export const mergeDuplicateConversations = internalMutation({
  args: { dryRun: v.boolean() },
  returns: v.array(v.object({ kept: v.id("comma_conversations"), removed: v.id("comma_conversations"), key: v.string() })),
  handler: async (ctx, { dryRun }) => {
    const byGuid = new Map<string, Doc<"comma_conversations">[]>();
    for (const conversation of await ctx.db.query("comma_conversations").collect()) {
      for (const chatGuid of conversation.chatGuids ?? []) {
        byGuid.set(chatGuid, [...(byGuid.get(chatGuid) ?? []), conversation]);
      }
    }
    const merges: { kept: Id<"comma_conversations">; removed: Id<"comma_conversations">; key: string }[] = [];
    const removed = new Set<string>();
    for (const group of byGuid.values()) {
      if (group.length < 2) continue;
      const [keep, ...rest] = [...group].sort((a, b) => a._creationTime - b._creationTime);
      if (!keep) continue;
      for (const dup of rest) {
        if (removed.has(dup._id) || dup._id === keep._id) continue;
        removed.add(dup._id);
        merges.push({ kept: keep._id, removed: dup._id, key: dup.conversationKey });
        if (dryRun) continue;
        const id = dup._id;
        const moved = [
          ...(await ctx.db.query("comma_messages").withIndex("by_conversation_date", (q) => q.eq("conversationId", id)).collect()),
          ...(await ctx.db.query("comma_attachments").withIndex("by_conversationId", (q) => q.eq("conversationId", id)).collect()),
          ...(await ctx.db.query("comma_reactions").withIndex("by_conversationId", (q) => q.eq("conversationId", id)).collect()),
          ...(await ctx.db.query("comma_drafts").withIndex("by_conversationId", (q) => q.eq("conversationId", id)).collect()),
          ...(await ctx.db.query("comma_suggestions").withIndex("by_conversationId", (q) => q.eq("conversationId", id)).collect()),
          ...(await ctx.db.query("comma_triage_events").withIndex("by_conversationId", (q) => q.eq("conversationId", id)).collect()),
          ...(await ctx.db.query("comma_conversation_state").withIndex("by_conversationId", (q) => q.eq("conversationId", id)).collect()),
        ];
        for (const row of moved) await ctx.db.patch(row._id, { conversationId: keep._id });
        const crm = [
          ...(await ctx.db.query("chat_crm").withIndex("by_conversation", (q) => q.eq("conversation_id", id)).collect()),
          ...(await ctx.db.query("tags").withIndex("by_conversation", (q) => q.eq("conversation_id", id)).collect()),
          ...(await ctx.db.query("event_links").withIndex("by_conversation", (q) => q.eq("conversation_id", id)).collect()),
        ];
        for (const row of crm) await ctx.db.patch(row._id, { conversation_id: keep._id });
        for (const alias of await ctx.db.query("comma_chat_aliases").withIndex("by_conversationId", (q) => q.eq("conversationId", dup._id)).collect()) {
          await ctx.db.patch(alias._id, { conversationId: keep._id });
        }
        // Outbox and scheduled have no conversationId index; both stay small.
        for (const row of [...(await ctx.db.query("comma_scheduled").collect()), ...(await ctx.db.query("comma_outbox").collect())]) {
          if (row.conversationId === dup._id) await ctx.db.patch(row._id, { conversationId: keep._id });
        }
        await ctx.db.patch(keep._id, {
          conversationKey: dup.conversationKey,
          lastMessage: keep.lastMessage ?? dup.lastMessage,
          lastMessageAt: Math.max(keep.lastMessageAt, dup.lastMessageAt),
          updatedAt: Date.now(),
        });
        await ctx.db.delete(dup._id);
      }
    }
    return merges;
  },
});

/** Bridge media seeding: on-disk attachments still missing Convex storage, a page at a time. */
export const mediaBacklog = internalMutation({
  args: { cursor: v.union(v.string(), v.null()), limit: v.number() },
  returns: v.object({
    items: v.array(v.object({
      guid: v.string(),
      mimeType: v.optional(v.string()),
      filename: v.optional(v.string()),
      createdAt: v.number(),
      needsThumb: v.boolean(),
      needsOriginal: v.boolean(),
    })),
    cursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { cursor, limit }) => {
    const page = await ctx.db.query("comma_attachments").paginate({ cursor, numItems: Math.min(limit, 500) });
    const items = page.page
      .filter((a) => !a.hideAttachment && (!a.thumbStorageId || !a.originalStorageId))
      .map((a) => ({
        guid: a.guid,
        mimeType: a.mimeType,
        filename: a.filename,
        createdAt: a._creationTime,
        needsThumb: !a.thumbStorageId,
        needsOriginal: !a.originalStorageId,
      }));
    return { items, cursor: page.continueCursor, isDone: page.isDone };
  },
});

export const setSuggestions = internalMutation({
  args: {
    conversationId: suggestionFields.conversationId,
    anchorGuid: suggestionFields.anchorGuid,
    payload: suggestionFields.payload,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("comma_suggestions")
      .withIndex("by_conversationId", (q) => q.eq("conversationId", args.conversationId))
      .unique();
    const row = { ...args, createdAt: Date.now() };
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("comma_suggestions", row);
    return null;
  },
});
