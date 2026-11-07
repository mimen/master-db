import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";

import { NOT_SENT_AFTER_MS, NOT_SENT_ERROR, isPendingGuid, pendingClientKey, pendingGuid } from "../../apps/imsg/shared/pending-send";
import { messageService } from "../../apps/imsg/shared/platform-profile";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";
import type { CommaOutboxPayload, CommaPendingSendState, CommaRoute } from "../schema/comma/validators";

import { refreshLastMessage } from "./internal";
import { enqueueCommand } from "./outbox";
import { profileRoute } from "./routeSupport";
import { carryTempAnchor } from "./triage";

/**
 * The lifecycle of a message the user sent that has not landed yet, for any platform. Its pending row in
 * comma_messages is the bubble every client draws; the outbox row is the work. Each transition below keeps the
 * two in step: create, claim, land (by receipt or by the platform's echo), strand, cancel and retry.
 * See apps/imsg/shared/pending-send.ts for the states.
 */

type ConversationId = Id<"comma_conversations">;
type SendPayload = Extract<CommaOutboxPayload, { kind: "send" }>;

const expireRef = makeFunctionReference<"mutation", { clientKey: string }, null>("comma/pendingSends:expire");

async function pendingRow(ctx: MutationCtx, clientKey: string): Promise<Doc<"comma_messages"> | null> {
  return await ctx.db.query("comma_messages").withIndex("by_guid", (q) => q.eq("guid", pendingGuid(clientKey))).unique();
}

async function sendRow(ctx: MutationCtx, clientKey: string): Promise<Doc<"comma_outbox"> | null> {
  const row = await ctx.db.query("comma_outbox").withIndex("by_clientKey", (q) => q.eq("clientKey", clientKey)).unique();
  return row?.payload.kind === "send" ? row : null;
}

/** The bubble shows at once, and the sidebar moves with it rather than a platform round trip later. */
export async function createPendingSend(ctx: MutationCtx, { conversation, route, clientKey, payload, now }: {
  conversation: Doc<"comma_conversations">; route: CommaRoute; clientKey: string; payload: SendPayload; now: number;
}): Promise<void> {
  // The real row's refreshLastMessage overwrites this preview, and a stranded send stays the preview.
  await ctx.db.patch(conversation._id, {
    lastMessage: { guid: pendingGuid(clientKey), text: payload.text, dateCreated: now, isFromMe: true, senderName: null, hasAttachments: false },
    lastMessageAt: Math.max(conversation.lastMessageAt, now),
  });
  await ctx.db.insert("comma_messages", {
    platform: route.platform,
    guid: pendingGuid(clientKey),
    conversationId: conversation._id,
    chatGuid: route.chatGuid,
    dateCreated: now,
    isFromMe: true,
    text: payload.text,
    service: messageService(profileRoute(route, conversation.isGroup).service),
    error: 0,
    edited: false,
    retracted: false,
    isTapback: false,
    reactions: [],
    replyToGuid: payload.replyToGuid,
    isGroupEvent: false,
    mentions: payload.mentions ?? [],
    attachmentGuids: [],
    clientKey,
    sourceVersion: 0,
    sendState: "queued",
  });
  await ctx.scheduler.runAfter(NOT_SENT_AFTER_MS, expireRef, { clientKey });
}

/** The executor took the send, so it is on its way and can no longer be cancelled. */
export async function claimPendingSend(ctx: MutationCtx, clientKey: string): Promise<void> {
  const row = await pendingRow(ctx, clientKey);
  if (row) await ctx.db.patch(row._id, { sendState: "sending" });
}

/**
 * A send that failed, whose outcome is unknown, or that nothing took in time is no longer in flight. Its bubble
 * takes that moment and sorts among the messages around its attempt instead of staying below the thread with the
 * sends still queued.
 */
export async function strandPendingSend(ctx: MutationCtx, clientKey: string, sendState: Extract<CommaPendingSendState, "failed" | "notSent">): Promise<void> {
  const row = await pendingRow(ctx, clientKey);
  if (row) await ctx.db.patch(row._id, { error: 1, dateCreated: Date.now(), sendState });
}

/** A queued send nothing took in time never goes out: it fails as Not sent, and the user decides whether to retry. */
export async function expireIfStale(ctx: MutationCtx, row: Doc<"comma_outbox">, now: number): Promise<boolean> {
  if (row.payload.kind !== "send" || row.status !== "pending" || now - row.createdAt < NOT_SENT_AFTER_MS) return false;
  await ctx.db.patch(row._id, { status: "failed", error: NOT_SENT_ERROR, updatedAt: now });
  await strandPendingSend(ctx, row.clientKey, "notSent");
  return true;
}

export const expire = internalMutation({
  args: { clientKey: v.string() },
  returns: v.null(),
  handler: async (ctx, { clientKey }) => {
    const row = await sendRow(ctx, clientKey);
    if (row) await expireIfStale(ctx, row, Date.now());
    return null;
  },
});

async function retire(ctx: MutationCtx, pending: Doc<"comma_messages">, realGuid: string): Promise<void> {
  await ctx.db.delete(pending._id);
  await carryTempAnchor(ctx, pending.conversationId, pending.guid, realGuid);
}

/**
 * The executor's receipt for a send. Platform echoes often omit the clientKey, so a confirmed send cannot wait for
 * a tagged echo to retire its pending row. It goes once the real row has landed; deleting it sooner blanked the
 * bubble and the sidebar preview until the echo arrived.
 */
export async function completePendingSend(ctx: MutationCtx, clientKey: string, status: "sent" | "failed" | "unknown", resultGuid?: string): Promise<void> {
  const pending = await pendingRow(ctx, clientKey);
  if (!pending) return;
  if (status !== "sent") return await strandPendingSend(ctx, clientKey, "failed");
  const real = resultGuid ? await ctx.db.query("comma_messages").withIndex("by_guid", (q) => q.eq("guid", resultGuid)).unique() : null;
  if (resultGuid && !real) return;
  if (resultGuid) await retire(ctx, pending, resultGuid);
  else await ctx.db.delete(pending._id);
  // An echo that beat this receipt left the pending row as the newest row and the preview.
  await refreshLastMessage(ctx, pending.conversationId);
}

/** An ingested message that is a queued send's platform copy, by the clientKey it carries or the send the outbox confirmed. */
export async function landEcho(ctx: MutationCtx, message: Pick<Doc<"comma_messages">, "guid" | "clientKey">): Promise<void> {
  if (isPendingGuid(message.guid)) return;
  const clientKey = message.clientKey ?? (await ctx.db.query("comma_outbox")
    .withIndex("by_resultGuid", (q) => q.eq("resultGuid", message.guid)).first())?.clientKey;
  const pending = clientKey ? await pendingRow(ctx, clientKey) : null;
  if (pending) await retire(ctx, pending, message.guid);
}

/** The pending row of the newest send the executor has not finished. */
export async function newestInFlight(ctx: MutationCtx, conversationId: ConversationId): Promise<Doc<"comma_messages"> | null> {
  let newest: Doc<"comma_outbox"> | null = null;
  for (const status of ["pending", "claimed"] as const) {
    // ponytail: scans only the 50 newest commands per status; past that the preview falls back to date order.
    const queued = await ctx.db.query("comma_outbox").withIndex("by_status_createdAt", (q) => q.eq("status", status)).order("desc").take(50);
    const send = queued.find((row) => row.conversationId === conversationId && row.payload.kind === "send");
    if (send && (!newest || send._creationTime > newest._creationTime)) newest = send;
  }
  return newest ? await pendingRow(ctx, newest.clientKey) : null;
}

/** A settle taken on a pending row still names the last message once its send lands as that message. */
export async function sameSend(ctx: MutationCtx, anchor: string, lastGuid: string): Promise<boolean> {
  const clientKey = pendingClientKey(anchor);
  if (clientKey === null) return false;
  if ((await sendRow(ctx, clientKey))?.resultGuid === lastGuid) return true;
  const real = await ctx.db.query("comma_messages").withIndex("by_guid", (q) => q.eq("guid", lastGuid)).unique();
  return real?.clientKey === clientKey;
}

/** Removes a send nothing has taken yet, so it never goes out. False once the executor has it. */
export const cancelSend = mutation({
  args: { clientKey: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { clientKey }) => {
    await assertAllowed(ctx);
    const row = await sendRow(ctx, clientKey);
    if (!row) return true;
    if (row.status !== "pending") return false;
    await ctx.db.delete(row._id);
    const pending = await pendingRow(ctx, clientKey);
    if (pending) {
      await ctx.db.delete(pending._id);
      await refreshLastMessage(ctx, pending.conversationId);
    }
    return true;
  },
});

/**
 * Sends a stranded send again as a new send under `retryKey`, in place of the old bubble. Only the user asks for
 * this: an unknown send may have gone out, so nothing retries one on its own.
 */
export const retrySend = mutation({
  args: { clientKey: v.string(), retryKey: v.string() },
  returns: v.id("comma_outbox"),
  handler: async (ctx, { clientKey, retryKey }) => {
    await assertAllowed(ctx);
    const retried = await ctx.db.query("comma_outbox").withIndex("by_clientKey", (q) => q.eq("clientKey", retryKey)).unique();
    if (retried) return retried._id;
    const row = await sendRow(ctx, clientKey);
    if (!row?.conversationId || (row.status !== "failed" && row.status !== "unknown")) throw new ConvexError("Only a send that did not go out can be retried");
    const pending = await pendingRow(ctx, clientKey);
    if (pending) await ctx.db.delete(pending._id);
    return (await enqueueCommand(ctx, { clientKey: retryKey, conversationId: row.conversationId, payload: row.payload })).id;
  },
});
