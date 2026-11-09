import { ConvexError, v } from "convex/values";

import { support } from "../../apps/imsg/shared/platform-profile";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";
import { sendPayload } from "../schema/comma/validators";

import { sendRoute } from "./conversationIdentity";
import { enqueueCommand } from "./enqueue";
import { profileRoute, unsupportedReason } from "./routeSupport";

/**
 * Scheduled messages Comma owns, for Slack and Gmail. Gmail has no scheduled send and Slack's would be a second list
 * with its own cancel, so the row lives here and a scheduler job queues it at its time as an ordinary send through the
 * conversation's lane. iMessage's are BlueBubbles' own queue, mirrored by replaceScheduled.
 */

type Scheduled = Doc<"comma_scheduled">;

async function commaRow(ctx: MutationCtx, scheduledId: Id<"comma_scheduled">): Promise<Scheduled & { payload: NonNullable<Scheduled["payload"]> }> {
  const row = await ctx.db.get(scheduledId);
  if (!row) throw new ConvexError("It already went out");
  if (!row.payload) throw new ConvexError("BlueBubbles sends this one");
  return { ...row, payload: row.payload };
}

/** Queues the row's send and drops the row, or marks it Not sent with the reason the send was refused. */
async function sendScheduled(ctx: MutationCtx, row: Scheduled & { payload: NonNullable<Scheduled["payload"]> }): Promise<string | null> {
  try {
    if (!row.conversationId) throw new ConvexError("Conversation not found");
    // One key per row, so the send queues once however many jobs reach it.
    await enqueueCommand(ctx, { clientKey: `scheduled-${row._id}`, conversationId: row.conversationId, payload: row.payload });
  } catch (error) {
    const reason = error instanceof ConvexError ? String(error.data) : error instanceof Error ? error.message : String(error);
    await ctx.db.patch(row._id, { status: "failed", error: reason, updatedAt: Date.now() });
    return reason;
  }
  await ctx.db.delete(row._id);
  return null;
}

export const schedule = mutation({
  args: { conversationId: v.id("comma_conversations"), payload: sendPayload, sendAt: v.number() },
  returns: v.id("comma_scheduled"),
  handler: async (ctx, { conversationId, payload, sendAt }) => {
    await assertAllowed(ctx);
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) throw new ConvexError("Conversation not found");
    if (conversation.platform !== "slack" && conversation.platform !== "gmail") throw new ConvexError("iMessage schedules through BlueBubbles");
    const route = sendRoute(conversation);
    const scheduling = support(profileRoute(route, conversation.isGroup), "schedule");
    if (!scheduling?.ok) throw new ConvexError(scheduling?.reason ?? "This conversation can't schedule messages");
    const unsupported = unsupportedReason(route, conversation.isGroup, payload);
    if (unsupported) throw new ConvexError(unsupported);
    const id = await ctx.db.insert("comma_scheduled", {
      platform: route.platform, accountId: route.accountId, conversationId, payload, text: payload.text, sendAt, status: "pending", updatedAt: Date.now(),
    });
    await ctx.scheduler.runAt(sendAt, internal.comma.scheduledSends.fire, { scheduledId: id, sendAt });
    return id;
  },
});

/** A new text or time; a Not sent one is scheduled again. */
export const edit = mutation({
  args: { scheduledId: v.id("comma_scheduled"), text: v.string(), sendAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { scheduledId, text, sendAt }) => {
    await assertAllowed(ctx);
    const row = await commaRow(ctx, scheduledId);
    await ctx.db.patch(row._id, { text, payload: { ...row.payload, text }, sendAt, status: "pending", error: undefined, updatedAt: Date.now() });
    // The job for the old time finds the time moved and does nothing.
    await ctx.scheduler.runAt(sendAt, internal.comma.scheduledSends.fire, { scheduledId, sendAt });
    return null;
  },
});

export const cancel = mutation({
  args: { scheduledId: v.id("comma_scheduled") },
  returns: v.null(),
  handler: async (ctx, { scheduledId }) => {
    await assertAllowed(ctx);
    await ctx.db.delete((await commaRow(ctx, scheduledId))._id);
    return null;
  },
});

export const sendNow = mutation({
  args: { scheduledId: v.id("comma_scheduled") },
  returns: v.null(),
  handler: async (ctx, { scheduledId }) => {
    await assertAllowed(ctx);
    const refused = await sendScheduled(ctx, await commaRow(ctx, scheduledId));
    if (refused) throw new ConvexError(refused);
    return null;
  },
});

/**
 * The scheduler's job. It reads the row in the same transaction that queues the send, so a cancel (which deleted the
 * row) or an edit (which moved its time) that committed first always wins.
 */
export const fire = internalMutation({
  args: { scheduledId: v.id("comma_scheduled"), sendAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { scheduledId, sendAt }) => {
    const row = await ctx.db.get(scheduledId);
    if (row?.payload && row.status === "pending" && row.sendAt === sendAt) await sendScheduled(ctx, { ...row, payload: row.payload });
    return null;
  },
});
