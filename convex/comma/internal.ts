import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import {
  attachmentFields,
  lastMessageSummary,
  messageFields,
  participant,
  scheduledStatus,
  type CommaReaction,
} from "../schema/comma/validators";

import { conversationKey } from "./conversationKey";

/**
 * Bridge write path for the Comma mirror. The bridge on the Mini calls these
 * through the /comma/ingest/* HTTP routes. Every function is idempotent: a
 * replayed batch leaves the same rows.
 *
 * Batch limits: keep calls at or under 200 messages or attachments. A Convex
 * mutation may write 8,192 documents and read 16,384, and each message write
 * can also touch its target, its conversation, and earlier tapbacks.
 */

const SERVICE_RANK: Record<string, number> = { iMessage: 0, RCS: 1, SMS: 2 };

function serviceOf(chatGuid: string): string {
  return chatGuid.split(";")[0] ?? "";
}

/** Newest activity wins; ties prefer iMessage, then RCS, then SMS, then guid order. */
export function choosePrimary(chats: { chatGuid: string; lastMessageAt: number }[]): string {
  const ranked = [...chats].sort(
    (a, b) =>
      b.lastMessageAt - a.lastMessageAt ||
      (SERVICE_RANK[serviceOf(a.chatGuid)] ?? 9) - (SERVICE_RANK[serviceOf(b.chatGuid)] ?? 9) ||
      a.chatGuid.localeCompare(b.chatGuid),
  );
  const first = ranked[0];
  if (!first) throw new Error("conversation has no chats");
  return first.chatGuid;
}

const conversationInput = v.object({
  conversationKey: v.string(),
  chats: v.array(v.object({ chatGuid: v.string(), lastMessageAt: v.number() })),
  displayName: v.string(),
  isGroup: v.boolean(),
  participants: v.array(participant),
  isSpam: v.boolean(),
  hasGroupPhoto: v.boolean(),
  lastMessage: v.optional(lastMessageSummary),
  lastMessageAt: v.number(),
});

export const upsertConversations = internalMutation({
  args: { conversations: v.array(conversationInput) },
  returns: v.record(v.string(), v.id("comma_conversations")),
  handler: async (ctx, { conversations }) => {
    const resolved: Record<string, Id<"comma_conversations">> = {};
    const now = Date.now();
    for (const input of conversations) {
      const primaryChatGuid = choosePrimary(input.chats);
      const chatGuids = input.chats.map((chat) => chat.chatGuid).sort();
      let existing = await ctx.db
        .query("comma_conversations")
        .withIndex("by_conversationKey", (q) => q.eq("conversationKey", input.conversationKey))
        .unique();
      if (!existing) {
        for (const chatGuid of chatGuids) {
          const alias = await ctx.db.query("comma_chat_aliases")
            .withIndex("by_chatGuid", (q) => q.eq("chatGuid", chatGuid)).unique();
          const candidate = alias ? await ctx.db.get(alias.conversationId) : null;
          if (candidate && conversationKey(candidate) === input.conversationKey) {
            existing = candidate;
            break;
          }
        }
      }
      const row = {
        conversationKey: input.conversationKey,
        primaryChatGuid,
        chatGuids,
        displayName: input.displayName,
        isGroup: input.isGroup,
        participants: input.participants,
        isSpam: input.isSpam,
        hasGroupPhoto: input.hasGroupPhoto,
        // Messages keep lastMessage current; a conversation snapshot only fills a gap.
        lastMessage: existing?.lastMessage ?? input.lastMessage,
        lastMessageAt: Math.max(existing?.lastMessageAt ?? 0, input.lastMessageAt),
        updatedAt: now,
      };
      const conversationId = existing ? existing._id : await ctx.db.insert("comma_conversations", row);
      if (existing) await ctx.db.patch(existing._id, row);

      for (const chatGuid of chatGuids) {
        const alias = await ctx.db
          .query("comma_chat_aliases")
          .withIndex("by_chatGuid", (q) => q.eq("chatGuid", chatGuid))
          .unique();
        if (!alias) {
          await ctx.db.insert("comma_chat_aliases", { chatGuid, conversationId, service: serviceOf(chatGuid) });
        } else if (alias.conversationId !== conversationId) {
          await ctx.db.patch(alias._id, { conversationId });
        }
        resolved[chatGuid] = conversationId;
      }
    }
    return resolved;
  },
});

/** Replays a target's tapback rows in date order into its folded reactions. */
export function foldTapbacks(tapbacks: Pick<Doc<"comma_messages">, "dateCreated" | "isFromMe" | "sender" | "tapback">[]): CommaReaction[] {
  let reactions: CommaReaction[] = [];
  for (const row of [...tapbacks].sort((a, b) => a.dateCreated - b.dateCreated)) {
    if (!row.tapback) continue;
    const senderAddress = row.sender?.address ?? null;
    // My own reactions share one sender regardless of address; others match by address.
    const sameSender = (r: CommaReaction) =>
      row.isFromMe ? r.isFromMe : !r.isFromMe && r.senderAddress === senderAddress;
    const same = (r: CommaReaction) =>
      sameSender(r) && r.type === row.tapback?.reaction && (r.emoji ?? null) === (row.tapback?.emoji ?? null);
    reactions = reactions.filter((r) => !same(r));
    if (!row.tapback.remove) {
      reactions.push({
        type: row.tapback.reaction,
        ...(row.tapback.emoji ? { emoji: row.tapback.emoji } : {}),
        isFromMe: row.isFromMe,
        senderName: row.sender?.name ?? null,
        senderAddress,
      });
    }
  }
  return reactions;
}

async function refoldTarget(ctx: MutationCtx, targetGuid: string): Promise<void> {
  const target = await ctx.db
    .query("comma_messages")
    .withIndex("by_guid", (q) => q.eq("guid", targetGuid))
    .unique();
  if (!target || target.isTapback) return;
  const tapbacks = await ctx.db
    .query("comma_messages")
    .withIndex("by_tapbackTargetGuid", (q) => q.eq("tapbackTargetGuid", targetGuid))
    .collect();
  await ctx.db.patch(target._id, { reactions: foldTapbacks(tapbacks) });
}

async function refreshLastMessage(ctx: MutationCtx, conversationId: Id<"comma_conversations">): Promise<void> {
  const conversation = await ctx.db.get(conversationId);
  if (!conversation) return;
  let newest: Doc<"comma_messages"> | null = null;
  for await (const message of ctx.db
    .query("comma_messages")
    .withIndex("by_conversation_date", (q) => q.eq("conversationId", conversationId))
    .order("desc")) {
    if (!message.isTapback && !message.retracted) {
      newest = message;
      break;
    }
  }
  if (!newest) return;
  await ctx.db.patch(conversationId, {
    lastMessage: {
      guid: newest.guid,
      text: newest.text,
      dateCreated: newest.dateCreated,
      isFromMe: newest.isFromMe,
      senderName: newest.sender?.name ?? null,
      hasAttachments: newest.attachmentGuids.length > 0,
    },
    lastMessageAt: Math.max(conversation.lastMessageAt, newest.dateCreated),
  });
}

export const upsertMessages = internalMutation({
  args: { messages: v.array(v.object(messageFields)) },
  returns: v.object({ written: v.number(), skipped: v.number() }),
  handler: async (ctx, { messages }) => {
    let written = 0;
    let skipped = 0;
    const touchedConversations = new Set<Id<"comma_conversations">>();
    const touchedTargets = new Set<string>();
    for (const message of messages) {
      const existing = await ctx.db
        .query("comma_messages")
        .withIndex("by_guid", (q) => q.eq("guid", message.guid))
        .unique();
      if (existing && existing.sourceVersion >= message.sourceVersion) {
        skipped++;
        continue;
      }
      // Folded reactions are derived; never let an incoming row clobber them.
      const row = { ...message, reactions: existing?.reactions ?? [] };
      if (existing) await ctx.db.patch(existing._id, row);
      else await ctx.db.insert("comma_messages", row);
      written++;
      touchedConversations.add(message.conversationId);
      // A tapback refolds its target; a normal message folds tapbacks that arrived first.
      touchedTargets.add(message.isTapback && message.tapbackTargetGuid ? message.tapbackTargetGuid : message.guid);
    }
    for (const targetGuid of touchedTargets) await refoldTarget(ctx, targetGuid);
    for (const conversationId of touchedConversations) await refreshLastMessage(ctx, conversationId);
    return { written, skipped };
  },
});

export const upsertAttachments = internalMutation({
  args: { attachments: v.array(v.object(attachmentFields)) },
  returns: v.object({ written: v.number(), skipped: v.number() }),
  handler: async (ctx, { attachments }) => {
    let written = 0;
    let skipped = 0;
    for (const attachment of attachments) {
      const existing = await ctx.db
        .query("comma_attachments")
        .withIndex("by_guid", (q) => q.eq("guid", attachment.guid))
        .unique();
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
      if (existing) await ctx.db.patch(existing._id, row);
      else await ctx.db.insert("comma_attachments", row);
      written++;
    }
    return { written, skipped };
  },
});

export const setTranscript = internalMutation({
  args: { attachmentGuid: v.string(), transcript: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { attachmentGuid, transcript }) => {
    const attachment = await ctx.db
      .query("comma_attachments")
      .withIndex("by_guid", (q) => q.eq("guid", attachmentGuid))
      .unique();
    if (!attachment) return false;
    await ctx.db.patch(attachment._id, { transcript });
    return true;
  },
});

async function conversationForChat(ctx: MutationCtx, chatGuid: string): Promise<Id<"comma_conversations"> | null> {
  const alias = await ctx.db
    .query("comma_chat_aliases")
    .withIndex("by_chatGuid", (q) => q.eq("chatGuid", chatGuid))
    .unique();
  return alias?.conversationId ?? null;
}

export const replaceScheduled = internalMutation({
  args: {
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
  handler: async (ctx, { items }) => {
    const now = Date.now();
    const keep = new Set(items.map((item) => item.bbId));
    let deleted = 0;
    for (const row of await ctx.db.query("comma_scheduled").collect()) {
      if (!keep.has(row.bbId)) {
        await ctx.db.delete(row._id);
        deleted++;
      }
    }
    for (const item of items) {
      const conversationId = (await conversationForChat(ctx, item.chatGuid)) ?? undefined;
      const existing = await ctx.db
        .query("comma_scheduled")
        .withIndex("by_bbId", (q) => q.eq("bbId", item.bbId))
        .unique();
      const row = { ...item, conversationId, updatedAt: now };
      if (existing) await ctx.db.patch(existing._id, row);
      else await ctx.db.insert("comma_scheduled", row);
    }
    return { upserted: items.length, deleted };
  },
});

async function messageDate(ctx: MutationCtx, guid: string | undefined): Promise<number> {
  if (!guid) return -1;
  const message = await ctx.db
    .query("comma_messages")
    .withIndex("by_guid", (q) => q.eq("guid", guid))
    .unique();
  return message?.dateCreated ?? 0;
}

/** Of two dismissal anchors, keep the one on the newer message. */
async function newerAnchor(ctx: MutationCtx, a: string | undefined, b: string | undefined): Promise<string | undefined> {
  if (!a) return b;
  if (!b) return a;
  return (await messageDate(ctx, b)) > (await messageDate(ctx, a)) ? b : a;
}

export const importOverlay = internalMutation({
  args: {
    chatState: v.array(
      v.object({
        chatGuid: v.string(),
        dismissedUnrespondedGuid: v.optional(v.string()),
        dismissedWaitingGuid: v.optional(v.string()),
        mutedUnresponded: v.boolean(),
        markedUnread: v.boolean(),
        pinned: v.boolean(),
        readAt: v.number(),
      }),
    ),
    triageEvents: v.array(
      v.object({
        chatGuid: v.string(),
        messageGuid: v.string(),
        reason: v.union(v.literal("reply"), v.literal("dismiss")),
        clearedAt: v.number(),
      }),
    ),
    triageOpen: v.array(v.object({ chatGuid: v.string(), messageGuid: v.string(), openedAt: v.number() })),
  },
  returns: v.object({ states: v.number(), events: v.number(), open: v.number(), unresolved: v.number() }),
  handler: async (ctx, { chatState, triageEvents, triageOpen }) => {
    let unresolved = 0;
    const merged = new Map<Id<"comma_conversations">, Omit<Doc<"comma_conversation_state">, "_id" | "_creationTime">>();
    for (const state of chatState) {
      const conversationId = await conversationForChat(ctx, state.chatGuid);
      if (!conversationId) {
        unresolved++;
        continue;
      }
      const prior = merged.get(conversationId);
      merged.set(conversationId, {
        conversationId,
        pinned: (prior?.pinned ?? false) || state.pinned,
        markedUnread: (prior?.markedUnread ?? false) || state.markedUnread,
        mutedUnresponded: (prior?.mutedUnresponded ?? false) || state.mutedUnresponded,
        readAt: Math.max(prior?.readAt ?? 0, state.readAt),
        dismissedUnrespondedGuid: await newerAnchor(ctx, prior?.dismissedUnrespondedGuid, state.dismissedUnrespondedGuid),
        dismissedWaitingGuid: await newerAnchor(ctx, prior?.dismissedWaitingGuid, state.dismissedWaitingGuid),
        updatedAt: Date.now(),
      });
    }
    for (const row of merged.values()) {
      const existing = await ctx.db
        .query("comma_conversation_state")
        .withIndex("by_conversationId", (q) => q.eq("conversationId", row.conversationId))
        .unique();
      if (existing) await ctx.db.patch(existing._id, row);
      else await ctx.db.insert("comma_conversation_state", row);
    }

    let events = 0;
    for (const event of triageEvents) {
      const conversationId = await conversationForChat(ctx, event.chatGuid);
      if (!conversationId) {
        unresolved++;
        continue;
      }
      const duplicate = (
        await ctx.db
          .query("comma_triage_events")
          .withIndex("by_conversationId", (q) => q.eq("conversationId", conversationId))
          .collect()
      ).some((row) => row.messageGuid === event.messageGuid && row.clearedAt === event.clearedAt);
      if (duplicate) continue;
      await ctx.db.insert("comma_triage_events", {
        conversationId,
        messageGuid: event.messageGuid,
        reason: event.reason,
        clearedAt: event.clearedAt,
      });
      events++;
    }

    let open = 0;
    for (const item of triageOpen) {
      const conversationId = await conversationForChat(ctx, item.chatGuid);
      if (!conversationId) {
        unresolved++;
        continue;
      }
      const existing = await ctx.db
        .query("comma_triage_open")
        .withIndex("by_conversationId", (q) => q.eq("conversationId", conversationId))
        .unique();
      if (existing && existing.openedAt >= item.openedAt) continue;
      const row = { conversationId, messageGuid: item.messageGuid, openedAt: item.openedAt };
      if (existing) await ctx.db.patch(existing._id, row);
      else await ctx.db.insert("comma_triage_open", row);
      open++;
    }
    return { states: merged.size, events, open, unresolved };
  },
});

export const markSyncState = internalMutation({
  args: {
    key: v.string(),
    cursor: v.optional(v.string()),
    lastEventAt: v.optional(v.number()),
    lastReconcileAt: v.optional(v.number()),
    counts: v.optional(v.record(v.string(), v.number())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("comma_sync_state")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    const row = { ...existing, ...args, updatedAt: Date.now() };
    if (existing) {
      const { _id, _creationTime, ...fields } = row as Doc<"comma_sync_state">;
      await ctx.db.patch(existing._id, fields);
    } else {
      await ctx.db.insert("comma_sync_state", { ...args, updatedAt: Date.now() });
    }
    return null;
  },
});
