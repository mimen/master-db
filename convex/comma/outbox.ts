import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { internalMutation, mutation, query } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";
import { commandReceipt, commandResult, outboxDoc, outboxPayload, outboxStatus, type CommaOutboxPayload } from "../schema/comma/validators";

import { deleteConversationDraft } from "./drafts";

/**
 * The command queue. Clients enqueue (Convex Auth); the Mini's bridge claims
 * and executes through BlueBubbles, then completes each row.
 *
 * BlueBubbles' tempGuid is not durable, so a send whose outcome is unknown
 * (the bridge died after handing it over) becomes "unknown" and is never
 * retried. Idempotent kinds re-run safely, so an expired lease returns them
 * to "pending".
 */
/** Every kind has an explicit recovery policy. Ambiguous side effects never replay. */
export const AUTO_RETRY = {
  send: false, react: false, edit: false, unsend: false, delete: false,
  pin: true, mute: true, markRead: true, markUnread: true, settle: true, unsettle: true, rename: true,
  schedule: false, editScheduled: false, cancelScheduled: false,
  createChat: false, sendContact: false, sendAttachment: false, participant: false,
  leaveGroup: false, deleteChat: false, sendScheduledNow: false, createFaceTimeLink: false,
  suggestionFeedback: false, typing: true, clearSuggestionLearning: true, suggestions: true, identify: true, transcribe: true,
} satisfies Record<CommaOutboxPayload["kind"], boolean>;
export const IDEMPOTENT_KINDS = new Set(Object.entries(AUTO_RETRY).filter(([, retry]) => retry).map(([kind]) => kind));
export const GLOBAL_KINDS = new Set<CommaOutboxPayload["kind"]>(["createChat", "clearSuggestionLearning"]);

/** Temp row guid for a queued send; the bridge's echo replaces it by clientKey. */
export function tempGuid(clientKey: string): string {
  return `temp-${clientKey}`;
}

export const enqueue = mutation({
  args: { clientKey: v.string(), conversationId: v.optional(v.id("comma_conversations")), payload: outboxPayload },
  returns: v.id("comma_outbox"),
  handler: async (ctx, { clientKey, conversationId, payload }) => {
    await assertAllowed(ctx);
    const existing = await ctx.db
      .query("comma_outbox")
      .withIndex("by_clientKey", (q) => q.eq("clientKey", clientKey))
      .unique();
    if (existing) return existing._id;
    if (!conversationId && !GLOBAL_KINDS.has(payload.kind)) throw new Error("conversationId is required for this command");
    const conversation = conversationId ? await ctx.db.get(conversationId) : null;
    if (conversationId && !conversation) throw new Error("Conversation not found");
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
    if (payload.kind === "send" && conversationId) {
      await deleteConversationDraft(ctx, conversationId);
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

export const getCommand = query({
  args: { commandId: v.id("comma_outbox") },
  returns: v.union(commandReceipt, v.null()),
  handler: async (ctx, { commandId }) => {
    await assertAllowed(ctx);
    const row = await ctx.db.get(commandId);
    if (!row) return null;
    return { commandId: row._id, clientKey: row.clientKey, status: row.status,
      ...(row.error !== undefined ? { error: row.error } : {}),
      ...(row.result !== undefined ? { result: row.result } : {}), updatedAt: row.updatedAt };
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
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error("leaseMs must be positive");
    if (!Number.isInteger(limit) || limit < 0 || limit > 50) throw new Error("limit must be between 0 and 50");
    // Expired leases first: a send can't be known to have failed, so it is never retried.
    for (const row of await ctx.db
      .query("comma_outbox")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "claimed"))
      .take(200)) {
      if ((row.leaseUntil ?? 0) > now) continue;
      const retry = IDEMPOTENT_KINDS.has(row.payload.kind);
      await ctx.db.patch(row._id, {
        status: retry ? "pending" : "unknown",
        error: retry ? undefined : "bridge stopped before confirming the command",
        leaseUntil: undefined,
        claimToken: undefined,
        updatedAt: now,
      });
    }
    const claimed: Doc<"comma_outbox">[] = [];
    for (const row of await ctx.db
      .query("comma_outbox")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "pending"))
      .order("asc")
      .take(limit)) {
      const patch = { claimToken: `${row._id}:${row.attempts + 1}`, error: undefined, status: "claimed" as const, leaseUntil: now + leaseMs, attempts: row.attempts + 1, updatedAt: now };
      await ctx.db.patch(row._id, patch);
      claimed.push({ ...row, ...patch });
    }
    return claimed;
  },
});

export const completeOutbox = internalMutation({
  args: {
    clientKey: v.string(),
    claimToken: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed"), v.literal("unknown")),
    error: v.optional(v.string()),
    resultGuid: v.optional(v.string()),
    result: v.optional(commandResult),
  },
  returns: v.boolean(),
  handler: async (ctx, { clientKey, claimToken, status, error, resultGuid, result }) => {
    const row = await ctx.db
      .query("comma_outbox")
      .withIndex("by_clientKey", (q) => q.eq("clientKey", clientKey))
      .unique();
    if (!row || row.claimToken !== claimToken) return false;
    // A retried receipt after an acknowledged completion cannot change the outcome.
    if (row.status !== "claimed") return row.status === status;
    if (result && result.kind !== row.payload.kind) throw new Error("Result kind does not match command kind");
    await ctx.db.patch(row._id, {
      status,
      leaseUntil: undefined,
      updatedAt: Date.now(),
      error,
      resultGuid,
      result,
    });
    if (row.payload.kind === "send") {
      const temp = await ctx.db
        .query("comma_messages")
        .withIndex("by_guid", (q) => q.eq("guid", tempGuid(clientKey)))
        .unique();
      // BlueBubbles echoes often omit tempGuid, so a confirmed send cannot wait for a
      // clientKey-tagged echo to retire its temp row; the real row arrives by guid.
      if (temp && status === "sent") await ctx.db.delete(temp._id);
      // A failed or unknown send keeps its temp bubble so the client can show the state.
      else if (temp) await ctx.db.patch(temp._id, { error: status === "failed" ? 1 : 0 });
    }
    return true;
  },
});

/** Renew only the current, still-live claim. Expired ownership cannot be resurrected. */
export const renewOutbox = internalMutation({
  args: { clientKey: v.string(), claimToken: v.string(), now: v.number(), leaseMs: v.number() },
  returns: v.boolean(),
  handler: async (ctx, { clientKey, claimToken, now, leaseMs }) => {
    const row = await ctx.db.query("comma_outbox").withIndex("by_clientKey", (q) => q.eq("clientKey", clientKey)).unique();
    if (!row || row.status !== "claimed" || row.claimToken !== claimToken || (row.leaseUntil ?? 0) <= now) return false;
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error("leaseMs must be positive");
    await ctx.db.patch(row._id, { leaseUntil: Math.max(row.leaseUntil ?? 0, now + leaseMs), updatedAt: now });
    return true;
  },
});
