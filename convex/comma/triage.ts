import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { mutation, type MutationCtx } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";

import { reopenConversationChats, settleConversationChats } from "./agent";
import { enqueueCommand } from "./outbox";

/**
 * Comma's own per-conversation triage state: settle anchors, pins, mutes, marked-unread, read times and the
 * clear log. Convex is its only writer. Each public mutation and the outbox's compatibility path for clients
 * that still enqueue these kinds share the cores below. Only a read reaches the Mini, for its iMessage receipt.
 */

type ConversationId = Id<"comma_conversations">;
type StateFields = Partial<Pick<Doc<"comma_conversation_state">,
  "dismissedUnrespondedGuid" | "dismissedWaitingGuid" | "mutedUnresponded" | "markedUnread" | "pinned" | "readAt">>;

async function stateOf(ctx: MutationCtx, conversationId: ConversationId) {
  return await ctx.db.query("comma_conversation_state")
    .withIndex("by_conversationId", (q) => q.eq("conversationId", conversationId)).unique();
}

async function writeState(ctx: MutationCtx, conversationId: ConversationId, fields: StateFields): Promise<void> {
  const row = await stateOf(ctx, conversationId);
  const updatedAt = Date.now();
  if (row) await ctx.db.patch(row._id, { ...fields, updatedAt });
  else await ctx.db.insert("comma_conversation_state", {
    conversationId, mutedUnresponded: false, markedUnread: false, pinned: false, readAt: 0, ...fields, updatedAt,
  });
}

function eventsFor(ctx: MutationCtx, conversationId: ConversationId, messageGuid: string) {
  return ctx.db.query("comma_triage_events")
    .withIndex("by_conversation_message", (q) => q.eq("conversationId", conversationId).eq("messageGuid", messageGuid));
}

async function logClear(ctx: MutationCtx, conversationId: ConversationId, messageGuid: string, reason: "reply" | "dismiss", clearedAt: number) {
  if (await eventsFor(ctx, conversationId, messageGuid).filter((q) => q.eq(q.field("reason"), reason)).first()) return;
  await ctx.db.insert("comma_triage_events", { conversationId, messageGuid, reason, clearedAt });
}

async function conversationOf(ctx: MutationCtx, conversationId: ConversationId): Promise<Doc<"comma_conversations">> {
  const conversation = await ctx.db.get(conversationId);
  if (!conversation) throw new ConvexError("Conversation not found");
  return conversation;
}

/**
 * Settles the conversation on its last message, the one every client shows and computeFlags compares. With an
 * anchor, a different last message rejects the settle, so a message the user has not seen is never dismissed.
 */
export async function settleConversation(ctx: MutationCtx, conversationId: ConversationId, anchor?: string): Promise<void> {
  const last = (await conversationOf(ctx, conversationId)).lastMessage;
  if (!last) throw new ConvexError("chat has no last message");
  if (anchor !== undefined && anchor !== last.guid) throw new ConvexError("latest message changed");
  await writeState(ctx, conversationId, last.isFromMe ? { dismissedWaitingGuid: last.guid } : { dismissedUnrespondedGuid: last.guid });
  await logClear(ctx, conversationId, last.guid, "dismiss", Date.now());
  await settleConversationChats(ctx, conversationId);
}

/** Clears both anchors, since the opposite one can hold a stale dismissal, and takes back the settle's clear. */
export async function unsettleConversation(ctx: MutationCtx, conversationId: ConversationId): Promise<void> {
  await conversationOf(ctx, conversationId);
  const row = await stateOf(ctx, conversationId);
  for (const anchor of [row?.dismissedUnrespondedGuid, row?.dismissedWaitingGuid]) {
    if (anchor === undefined) continue;
    for (const event of await eventsFor(ctx, conversationId, anchor).collect()) {
      if (event.reason === "dismiss") await ctx.db.delete(event._id);
    }
  }
  if (row) await ctx.db.patch(row._id, { dismissedUnrespondedGuid: undefined, dismissedWaitingGuid: undefined, updatedAt: Date.now() });
  await reopenConversationChats(ctx, conversationId);
}

export async function setConversationFlag(ctx: MutationCtx, conversationId: ConversationId,
  fields: Pick<StateFields, "pinned" | "mutedUnresponded" | "markedUnread">): Promise<void> {
  await conversationOf(ctx, conversationId);
  await writeState(ctx, conversationId, fields);
}

/** readAt never moves back, and never past now: a fast client clock must not mark later messages read. */
export async function readConversation(ctx: MutationCtx, conversationId: ConversationId, at: number): Promise<void> {
  await conversationOf(ctx, conversationId);
  const prior = (await stateOf(ctx, conversationId))?.readAt ?? 0;
  await writeState(ctx, conversationId, { readAt: Math.max(prior, Math.min(at, Date.now())), markedUnread: false });
}

/** A settle taken on a send still in flight anchored its temp row; the real message inherits it when the temp goes. */
export async function carryTempAnchor(ctx: MutationCtx, conversationId: ConversationId, tempGuid: string, realGuid: string): Promise<void> {
  const row = await stateOf(ctx, conversationId);
  if (row?.dismissedWaitingGuid === tempGuid) await ctx.db.patch(row._id, { dismissedWaitingGuid: realGuid });
  for (const event of await eventsFor(ctx, conversationId, tempGuid).collect()) await ctx.db.patch(event._id, { messageGuid: realGuid });
}

/** How far back a reply looks for the inbound message it answered; a longer run of sends has long since logged it. */
const REPLY_LOOKBACK = 50;

/**
 * A real outbound message newer than the last inbound one means that inbound message was answered. Unless a settle
 * already cleared it, the clear log records the reply at the time of the first send after it. Ingest replays
 * messages, so this runs on every batch and writes at most once per inbound message.
 */
export async function logReply(ctx: MutationCtx, conversationId: ConversationId): Promise<void> {
  let reply: Doc<"comma_messages"> | null = null;
  let scanned = 0;
  for await (const message of ctx.db.query("comma_messages")
    .withIndex("by_conversation_date", (q) => q.eq("conversationId", conversationId)).order("desc")) {
    if (++scanned > REPLY_LOOKBACK) return;
    if (message.isTapback || message.retracted) continue;
    if (message.isFromMe) {
      if (!message.guid.startsWith("temp-")) reply = message;
      continue;
    }
    if (!reply) return;
    if ((await stateOf(ctx, conversationId))?.dismissedUnrespondedGuid === message.guid) return;
    await logClear(ctx, conversationId, message.guid, "reply", reply.dateCreated);
    return;
  }
}

const conversationId = v.id("comma_conversations");

export const settle = mutation({
  args: { conversationId, anchor: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertAllowed(ctx);
    await settleConversation(ctx, args.conversationId, args.anchor);
    return null;
  },
});

export const unsettle = mutation({
  args: { conversationId },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertAllowed(ctx);
    await unsettleConversation(ctx, args.conversationId);
    return null;
  },
});

export const setPinned = mutation({
  args: { conversationId, pinned: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertAllowed(ctx);
    await setConversationFlag(ctx, args.conversationId, { pinned: args.pinned });
    return null;
  },
});

export const setMuted = mutation({
  args: { conversationId, muted: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertAllowed(ctx);
    await setConversationFlag(ctx, args.conversationId, { mutedUnresponded: args.muted });
    return null;
  },
});

export const markUnread = mutation({
  args: { conversationId },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertAllowed(ctx);
    await setConversationFlag(ctx, args.conversationId, { markedUnread: true });
    return null;
  },
});

/** Reads the conversation in Convex at once and queues the Mini's read receipt, whose outcome never undoes the read. */
export const markRead = mutation({
  args: { conversationId, at: v.number() },
  returns: v.id("comma_outbox"),
  handler: async (ctx, args) => {
    await assertAllowed(ctx);
    await readConversation(ctx, args.conversationId, args.at);
    const { id } = await enqueueCommand(ctx, {
      clientKey: `markRead-${args.conversationId}-${Date.now()}`, conversationId: args.conversationId, payload: { kind: "markRead" },
    });
    return id;
  },
});
