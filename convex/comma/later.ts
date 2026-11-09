import { ConvexError, v } from "convex/values";

import { attentionOf } from "../../apps/imsg/shared/platform-profile";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";

import { conversationKind } from "./conversationIdentity";
import { conversationView, withConversationState, listReader } from "./queries";
import { conversationOf, stateOf, writeState } from "./triage";

/**
 * Later and Follow up, Comma's own deferrals on comma_conversation_state. Neither touches the platform: a snoozed
 * Gmail thread stays in Gmail's inbox. A scheduled wake brings each back at its time; ingest brings a snooze back
 * early on a new inbound message, and cancels a follow-up once anyone else writes.
 */

type ConversationId = Id<"comma_conversations">;

function future(at: number): void {
  if (!(at > Date.now())) throw new ConvexError("Pick a time in the future");
}

export async function snoozeConversation(ctx: MutationCtx, conversationId: ConversationId, until: number): Promise<void> {
  future(until);
  await conversationOf(ctx, conversationId);
  const row = await stateOf(ctx, conversationId);
  if (row?.snooze) await ctx.scheduler.cancel(row.snooze.job);
  const job = await ctx.scheduler.runAt(until, internal.comma.later.wake, { conversationId, until });
  await writeState(ctx, conversationId, { snooze: { until, setAt: Date.now(), job }, snoozeReturn: undefined });
}

export async function unsnoozeConversation(ctx: MutationCtx, conversationId: ConversationId): Promise<void> {
  const row = await stateOf(ctx, conversationId);
  if (!row?.snooze) return;
  await ctx.scheduler.cancel(row.snooze.job);
  await writeState(ctx, conversationId, { snooze: undefined });
}

/** Waits on the user's own last message: a conversation where someone else spoke last already needs a reply. */
export async function followUpConversation(ctx: MutationCtx, conversationId: ConversationId, at: number): Promise<void> {
  future(at);
  const last = (await conversationOf(ctx, conversationId)).lastMessage;
  if (!last?.isFromMe) throw new ConvexError("Follow up needs your message to be the last one");
  const row = await stateOf(ctx, conversationId);
  if (row?.followUp?.job) await ctx.scheduler.cancel(row.followUp.job);
  const job = await ctx.scheduler.runAt(at, internal.comma.later.followUpDue, { conversationId, at });
  await writeState(ctx, conversationId, { followUp: { at, since: last.dateCreated, due: false, job } });
}

export async function clearFollowUpOf(ctx: MutationCtx, conversationId: ConversationId): Promise<void> {
  const row = await stateOf(ctx, conversationId);
  if (!row?.followUp) return;
  if (row.followUp.job) await ctx.scheduler.cancel(row.followUp.job);
  await writeState(ctx, conversationId, { followUp: undefined });
}

type Ingested = Pick<Doc<"comma_messages">, "conversationId" | "dateCreated" | "isFromMe" | "mentionsMe">;

const newest = (messages: readonly Ingested[]) => messages.reduce<Ingested | null>((a, b) => (a && a.dateCreated >= b.dateCreated ? a : b), null);

/**
 * Ingest's half. An inbound message the platform would ask the user about (any DM message, a channel's @-mention) ends
 * a snooze early; any inbound message answers a follow-up. The user's own message after a resurfacing answers that.
 * Dates, not arrival, decide, so a backfill or an edit of an old message changes nothing. A shared millisecond counts as after.
 */
export async function resurfaceOnMessages(ctx: MutationCtx, ingested: readonly Ingested[]): Promise<void> {
  for (const conversationId of new Set(ingested.map((message) => message.conversationId))) {
    const row = await stateOf(ctx, conversationId);
    if (!row?.snooze && !row?.snoozeReturn && !row?.followUp) continue;
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) continue;
    const ruled = { platform: conversation.platform ?? "imessage", kind: conversationKind(conversation), following: conversation.slack?.following };
    const mine = ingested.filter((message) => message.conversationId === conversationId);
    const inbound = newest(mine.filter((message) => !message.isFromMe));
    const outbound = newest(mine.filter((message) => message.isFromMe));
    let { snooze, snoozeReturn, followUp } = row;
    const setAt = snooze?.setAt ?? Infinity;
    const waker = newest(mine.filter((message) => !message.isFromMe && message.dateCreated >= setAt && attentionOf(ruled, message) === "needsYou"));
    if (snooze && waker) {
      await ctx.scheduler.cancel(snooze.job);
      snoozeReturn = { reason: "message", until: snooze.until, at: waker.dateCreated };
      snooze = undefined;
    }
    if (followUp && inbound && inbound.dateCreated >= followUp.since) {
      if (followUp.job) await ctx.scheduler.cancel(followUp.job);
      followUp = undefined;
    }
    if (outbound && snoozeReturn && outbound.dateCreated >= snoozeReturn.at) snoozeReturn = undefined;
    if (outbound && followUp?.due && outbound.dateCreated >= followUp.at) followUp = undefined;
    if (snooze !== row.snooze || snoozeReturn !== row.snoozeReturn || followUp !== row.followUp) {
      await writeState(ctx, conversationId, { snooze, snoozeReturn, followUp });
    }
  }
}

const conversationId = v.id("comma_conversations");

/** A wake for a snooze since replaced or ended finds a different `until`, or none, and does nothing. */
export const wake = internalMutation({
  args: { conversationId, until: v.number() },
  returns: v.null(),
  handler: async (ctx, { conversationId, until }) => {
    const row = await stateOf(ctx, conversationId);
    if (row?.snooze?.until !== until) return null;
    await writeState(ctx, conversationId, { snooze: undefined, snoozeReturn: { reason: "time", until, at: Date.now() } });
    return null;
  },
});

export const followUpDue = internalMutation({
  args: { conversationId, at: v.number() },
  returns: v.null(),
  handler: async (ctx, { conversationId, at }) => {
    const row = await stateOf(ctx, conversationId);
    const followUp = row?.followUp;
    if (!followUp || followUp.at !== at || followUp.due) return null;
    await writeState(ctx, conversationId, { followUp: { at, since: followUp.since, due: true } });
    return null;
  },
});

export const snooze = mutation({
  args: { conversationId, until: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertAllowed(ctx);
    await snoozeConversation(ctx, args.conversationId, args.until);
    return null;
  },
});

export const unsnooze = mutation({
  args: { conversationId },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertAllowed(ctx);
    await unsnoozeConversation(ctx, args.conversationId);
    return null;
  },
});

export const setFollowUp = mutation({
  args: { conversationId, at: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertAllowed(ctx);
    await followUpConversation(ctx, args.conversationId, args.at);
    return null;
  },
});

export const clearFollowUp = mutation({
  args: { conversationId },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertAllowed(ctx);
    await clearFollowUpOf(ctx, args.conversationId);
    return null;
  },
});

/** The Snoozed view, every platform's, soonest back first. */
export const listSnoozed = query({
  args: {},
  returns: v.array(conversationView),
  handler: async (ctx) => {
    await assertAllowed(ctx);
    // ponytail: the 100 soonest; paginate if a longer snooze list ever matters.
    const rows = await ctx.db.query("comma_conversation_state").withIndex("by_snoozeUntil", (q) => q.gte("snooze.until", 0)).take(100);
    const read = listReader(ctx);
    const conversations = await Promise.all(rows.map((row) => ctx.db.get(row.conversationId)));
    return await Promise.all(conversations.filter((c) => c !== null).map((c) => withConversationState(ctx, c, read)));
  },
});
