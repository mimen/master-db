import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { internalMutation, mutation, query } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";
import { outboxDoc, outboxPayload, outboxStatus } from "../schema/comma/validators";

/**
 * The command queue. Clients enqueue (Convex Auth); the Mini's bridge claims
 * and executes through BlueBubbles, then completes each row.
 *
 * BlueBubbles' tempGuid is not durable, so a send whose outcome is unknown
 * (the bridge died after handing it over) becomes "unknown" and is never
 * retried. Idempotent kinds re-run safely, so an expired lease returns them
 * to "pending".
 */
export const IDEMPOTENT_KINDS = new Set(["pin", "mute", "markRead", "markUnread", "settle", "unsettle", "rename"]);

/** Temp row guid for a queued send; the bridge's echo replaces it by clientKey. */
export function tempGuid(clientKey: string): string {
  return `temp-${clientKey}`;
}

export const enqueue = mutation({
  args: { clientKey: v.string(), conversationId: v.id("comma_conversations"), payload: outboxPayload },
  returns: v.id("comma_outbox"),
  handler: async (ctx, { clientKey, conversationId, payload }) => {
    await assertAllowed(ctx);
    const existing = await ctx.db
      .query("comma_outbox")
      .withIndex("by_clientKey", (q) => q.eq("clientKey", clientKey))
      .unique();
    if (existing) return existing._id;
    const now = Date.now();
    const id = await ctx.db.insert("comma_outbox", {
      clientKey,
      conversationId,
      payload,
      status: "pending",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
    if (payload.kind === "send") {
      const conversation = await ctx.db.get(conversationId);
      await ctx.db.insert("comma_messages", {
        guid: tempGuid(clientKey),
        conversationId,
        chatGuid: conversation?.primaryChatGuid ?? "",
        dateCreated: now,
        isFromMe: true,
        text: payload.text,
        service: conversation?.primaryChatGuid.startsWith("SMS;") ? "SMS" : "iMessage",
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
      });
    }
    return id;
  },
});

export const outboxStatusFor = query({
  args: { clientKeys: v.array(v.string()) },
  returns: v.array(v.object({ clientKey: v.string(), status: outboxStatus, error: v.optional(v.string()) })),
  handler: async (ctx, { clientKeys }) => {
    await assertAllowed(ctx);
    const rows: { clientKey: string; status: Doc<"comma_outbox">["status"]; error?: string }[] = [];
    for (const clientKey of clientKeys.slice(0, 100)) {
      const row = await ctx.db
        .query("comma_outbox")
        .withIndex("by_clientKey", (q) => q.eq("clientKey", clientKey))
        .unique();
      if (row) rows.push({ clientKey, status: row.status, ...(row.error ? { error: row.error } : {}) });
    }
    return rows;
  },
});

function sameSecret(provided: string): boolean {
  const expected = process.env.COMMA_BRIDGE_SECRET ?? "";
  if (!expected) return false;
  let difference = expected.length ^ provided.length;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ (provided.charCodeAt(i) || 0);
  return difference === 0;
}

/**
 * The bridge subscribes to this with ConvexClient for push delivery. Internal
 * queries can't be subscribed from outside Convex, so this one public query is
 * gated by the bridge secret instead of Convex Auth.
 */
export const pendingOutbox = query({
  args: { bridgeKey: v.string() },
  returns: v.array(outboxDoc),
  handler: async (ctx, { bridgeKey }) => {
    if (!sameSecret(bridgeKey)) throw new Error("Unauthorized");
    return await ctx.db
      .query("comma_outbox")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "pending"))
      .order("asc")
      .take(50);
  },
});

export const claimOutbox = internalMutation({
  args: { now: v.number(), leaseMs: v.number(), limit: v.number() },
  returns: v.array(outboxDoc),
  handler: async (ctx, { now, leaseMs, limit }) => {
    // Expired leases first: a send can't be known to have failed, so it is never retried.
    for (const row of await ctx.db
      .query("comma_outbox")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "claimed"))
      .take(200)) {
      if ((row.leaseUntil ?? 0) > now) continue;
      const retry = IDEMPOTENT_KINDS.has(row.payload.kind);
      await ctx.db.patch(row._id, {
        status: retry ? "pending" : "unknown",
        ...(retry ? {} : { error: "bridge stopped before confirming the send" }),
        updatedAt: now,
      });
    }
    const claimed: Doc<"comma_outbox">[] = [];
    for (const row of await ctx.db
      .query("comma_outbox")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "pending"))
      .order("asc")
      .take(limit)) {
      const patch = { status: "claimed" as const, leaseUntil: now + leaseMs, attempts: row.attempts + 1, updatedAt: now };
      await ctx.db.patch(row._id, patch);
      claimed.push({ ...row, ...patch });
    }
    return claimed;
  },
});

export const completeOutbox = internalMutation({
  args: {
    clientKey: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed"), v.literal("unknown")),
    error: v.optional(v.string()),
    resultGuid: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, { clientKey, status, error, resultGuid }) => {
    const row = await ctx.db
      .query("comma_outbox")
      .withIndex("by_clientKey", (q) => q.eq("clientKey", clientKey))
      .unique();
    if (!row) return false;
    await ctx.db.patch(row._id, {
      status,
      leaseUntil: undefined,
      updatedAt: Date.now(),
      ...(error ? { error } : {}),
      ...(resultGuid ? { resultGuid } : {}),
    });
    // A failed or unknown send keeps its temp bubble so the client can show the state.
    if (status !== "sent" && row.payload.kind === "send") {
      const temp = await ctx.db
        .query("comma_messages")
        .withIndex("by_guid", (q) => q.eq("guid", tempGuid(clientKey)))
        .unique();
      if (temp) await ctx.db.patch(temp._id, { error: status === "failed" ? 1 : 0 });
    }
    return true;
  },
});
