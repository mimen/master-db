import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, query, type QueryCtx } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";
import { presenceFields } from "../schema/comma/validators";

import { bridgeStateValue, publishBridgeState } from "./bridgeState";

export const presenceValue = v.object(presenceFields);
export const ephemeralInput = v.union(
  v.object({ kind: v.literal("presence"), ...presenceFields }),
  v.object({ kind: v.literal("bridgeState"), ...bridgeStateValue.fields }),
  v.object({ kind: v.literal("typingCurrent"), clientKey: v.string(), claimToken: v.string() }),
);

async function latestTyping(ctx: Pick<QueryCtx, "db">, row: Doc<"comma_outbox">): Promise<Doc<"comma_outbox">> {
  let latest = row;
  for (const status of ["pending", "claimed", "sent", "failed", "unknown"] as const) {
    const newer = await ctx.db.query("comma_outbox")
      .withIndex("by_status_createdAt", (q) => q.eq("status", status).gte("createdAt", row.createdAt))
      .filter((q) => q.and(q.eq(q.field("conversationId"), row.conversationId), q.eq(q.field("payload.kind"), "typing")))
      .collect();
    for (const next of newer) {
      if (next._creationTime > latest._creationTime ||
        (next._creationTime === latest._creationTime && next._id > latest._id)) latest = next;
    }
  }
  return latest;
}

const expireTypingRef = makeFunctionReference<"mutation", { commandId: Id<"comma_outbox"> }, null>("comma/presence:expireTyping");

export const expireTyping = internalMutation({
  args: { commandId: v.id("comma_outbox") },
  returns: v.null(),
  handler: async (ctx, { commandId }) => {
    const original = await ctx.db.get(commandId);
    if (!original?.conversationId || original.payload.kind !== "typing") return null;
    const row = await latestTyping(ctx, original);
    if (!row.conversationId || row.payload.kind !== "typing" || !row.payload.active) return null;
    if (row.payload.expiresAt > Date.now()) {
      await ctx.scheduler.runAt(row.payload.expiresAt, expireTypingRef, { commandId: row._id });
      return null;
    }
    if (!await ctx.db.get(row.conversationId)) return null;
    const clientKey = `typing-expire:${row._id}`;
    const existing = await ctx.db.query("comma_outbox").withIndex("by_clientKey", (q) => q.eq("clientKey", clientKey)).unique();
    if (!existing) await ctx.db.insert("comma_outbox", {
      clientKey, conversationId: row.conversationId, payload: { kind: "typing", active: false, expiresAt: row.payload.expiresAt },
      status: "pending", attempts: 0, createdAt: Date.now(), updatedAt: Date.now(),
    });
    return null;
  },
});

// The shared executor claims one row at a time, so typing checks successors here.
export const publish = internalMutation({
  args: { state: ephemeralInput },
  returns: v.boolean(),
  handler: async (ctx, { state }) => {
    if (state.kind === "typingCurrent") {
      const row = await ctx.db.query("comma_outbox").withIndex("by_clientKey", (q) => q.eq("clientKey", state.clientKey)).unique();
      if (!row || row.payload.kind !== "typing" || row.status !== "claimed" || row.claimToken !== state.claimToken || !row.conversationId || (row.leaseUntil ?? 0) <= Date.now()) return false;
      if ((await latestTyping(ctx, row))._id !== row._id) return false;
      if (row.payload.active) {
        if (row.payload.expiresAt <= Date.now()) return false;
        // A process kill loses the bridge's timer; this clear survives downtime.
        await ctx.scheduler.runAt(row.payload.expiresAt, expireTypingRef, { commandId: row._id });
      }
      return true;
    }
    const { kind, ...value } = state;
    if (kind === "bridgeState" && "key" in value) {
      await publishBridgeState(ctx, value);
      return true;
    }
    if (!("conversationId" in value)) throw new Error("Invalid presence record");
    if (!await ctx.db.get(value.conversationId)) throw new Error("Conversation not found");
    const existing = await ctx.db.query("comma_presence").withIndex("by_conversationId", (q) => q.eq("conversationId", value.conversationId)).unique();
    if (existing && existing.updatedAt > value.updatedAt) return false;
    const record = { ...value, peerTyping: value.peerTyping && value.expiresAt > Date.now() };
    if (existing) await ctx.db.replace(existing._id, record);
    else await ctx.db.insert("comma_presence", record);
    return true;
  },
});

export const presence = query({
  args: { conversationId: v.id("comma_conversations") },
  returns: v.union(v.object({ peerTyping: v.boolean(), updatedAt: v.number(), expiresAt: v.number() }), v.null()),
  handler: async (ctx, { conversationId }) => {
    await assertAllowed(ctx);
    const row = await ctx.db.query("comma_presence").withIndex("by_conversationId", (q) => q.eq("conversationId", conversationId)).unique();
    // Callers judge expiry against their own clock; a query that read it would never re-run when it lapsed.
    return row ? { peerTyping: row.peerTyping, updatedAt: row.updatedAt, expiresAt: row.expiresAt } : null;
  },
});
