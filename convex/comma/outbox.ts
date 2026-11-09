import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";
import {
  commandReceipt, commandResult, legacyTriagePayload, outboxDoc, outboxLane, outboxPayload, outboxStatus,
  type CommaOutboxLane, type CommaOutboxPayload, type CommaOutboxStatus,
} from "../schema/comma/validators";

import { settleDraftChat } from "./agent";
import { sameSecret } from "./bridgeAuth";
import { enqueueCommand } from "./enqueue";
import { laneOf, laneOfRow, laneSpec, wakeLane } from "./lanes";
import { claimPendingSend, completePendingSend, expireIfStale, strandPendingSend } from "./pendingSends";
import { readConversation, setConversationFlag, settleConversation, unsettleConversation } from "./triage";

/**
 * The command queue. Clients enqueue (Convex Auth); each lane's executor claims and executes its rows, then
 * completes each one: the Mini for a pull lane, a Convex action for a convex lane (see lanes.ts).
 *
 * A send whose outcome is unknown (the bridge died after handing it over)
 * becomes "unknown" and is never retried. Idempotent kinds re-run safely, so
 * an expired lease returns them to "pending". A send's bubble is the
 * pendingSends module's.
 */
/** Every kind has an explicit recovery policy. Ambiguous side effects never replay. */
export const AUTO_RETRY = {
  send: false, react: false, edit: false, unsend: false, delete: false,
  pin: true, mute: true, markRead: true, markUnread: true, settle: true, unsettle: true, rename: true,
  schedule: false, editScheduled: false, cancelScheduled: false,
  createChat: false, sendContact: false, sendAttachment: false, participant: false,
  leaveGroup: false, deleteChat: false, sendScheduledNow: false, createFaceTimeLink: false,
  archive: true, unarchive: true, sendEmail: false,
  suggestionFeedback: false, typing: true, clearSuggestionLearning: true, suggestions: true, identify: true, transcribe: true, personSummary: true,
} satisfies Record<CommaOutboxPayload["kind"], boolean>;
export const IDEMPOTENT_KINDS = new Set(Object.entries(AUTO_RETRY).filter(([, retry]) => retry).map(([kind]) => kind));

type TriagePayload = typeof legacyTriagePayload.type;

const TRIAGE_KINDS: ReadonlySet<CommaOutboxPayload["kind"]> = new Set(legacyTriagePayload.members.map((member) => member.fields.kind.value));
const isTriage = (payload: CommaOutboxPayload): payload is TriagePayload => TRIAGE_KINDS.has(payload.kind);

async function triageCore(ctx: MutationCtx, conversationId: Id<"comma_conversations">, payload: TriagePayload): Promise<void> {
  switch (payload.kind) {
    case "settle": return await settleConversation(ctx, conversationId, payload.messageGuid);
    case "unsettle": return await unsettleConversation(ctx, conversationId);
    case "pin": return await setConversationFlag(ctx, conversationId, { pinned: payload.value });
    case "mute": return await setConversationFlag(ctx, conversationId, { mutedUnresponded: payload.value });
    case "markUnread": return await setConversationFlag(ctx, conversationId, { markedUnread: true });
  }
}

/**
 * A triage command queued before Convex owned these kinds is applied when the Mini would have claimed it, so it
 * never reaches a Mini that no longer applies them. A stale anchor fails it, as it would have on the Mini.
 */
async function applyQueuedTriage(ctx: MutationCtx, row: Doc<"comma_outbox"> & { conversationId: Id<"comma_conversations"> }, payload: TriagePayload, now: number) {
  try {
    await triageCore(ctx, row.conversationId, payload);
    await ctx.db.patch(row._id, { status: "sent", result: { kind: payload.kind, ok: true }, error: undefined, updatedAt: now });
  } catch (error) {
    // A throw here would fail every claim after it and stall the queue, so any failure fails only this row.
    const message = error instanceof ConvexError ? String(error.data) : error instanceof Error ? error.message : String(error);
    await ctx.db.patch(row._id, { status: "failed", error: message, updatedAt: now });
  }
}

/**
 * A client from before comma/triage still enqueues triage kinds. They apply here through the same cores and
 * complete at once, so the Mini never claims them; a read also queues the Mini's receipt as before.
 */
async function applyTriage(ctx: MutationCtx, clientKey: string, conversationId: Id<"comma_conversations">, payload: TriagePayload) {
  const existing = await ctx.db.query("comma_outbox").withIndex("by_clientKey", (q) => q.eq("clientKey", clientKey)).unique();
  if (existing) return existing._id;
  await triageCore(ctx, conversationId, payload);
  const now = Date.now();
  return await ctx.db.insert("comma_outbox", {
    // Only clients from before comma/triage, all iMessage's, send these.
    clientKey, conversationId, payload, lane: laneOf("imessage", payload).lane, status: "sent", result: { kind: payload.kind, ok: true }, attempts: 0, createdAt: now, updatedAt: now,
  });
}

export const enqueue = mutation({
  args: { clientKey: v.string(), conversationId: v.optional(v.id("comma_conversations")), payload: outboxPayload },
  returns: v.id("comma_outbox"),
  handler: async (ctx, args) => {
    await assertAllowed(ctx);
    const { conversationId, payload } = args;
    if (conversationId && isTriage(payload)) return await applyTriage(ctx, args.clientKey, conversationId, payload);
    const { id, created } = await enqueueCommand(ctx, args);
    if (!created || !conversationId) return id;
    if (payload.kind === "markRead") await readConversation(ctx, conversationId, Date.now());
    if (payload.kind === "send" || payload.kind === "sendAttachment") {
      // The composer's own send takes its draft with it, and sending a drafted attachment sends the
      // whole draft. An agent send goes through enqueueCommand and leaves the user's draft alone.
      const draft = await ctx.db.query("comma_drafts").withIndex("by_conversationId", (q) => q.eq("conversationId", conversationId)).unique();
      if (draft && (payload.kind === "send" || draft.attachments?.some((a) => a.storageId === payload.storageId))) {
        await settleDraftChat(ctx, draft);
        await ctx.db.delete(draft._id);
      }
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

/** One status's rows in a lane, oldest first. */
async function laneRows(ctx: QueryCtx, lane: CommaOutboxLane, status: CommaOutboxStatus, limit: number) {
  return await ctx.db.query("comma_outbox")
    .withIndex("by_lane_status_createdAt", (q) => q.eq("lane", lane).eq("status", status)).order("asc").take(limit);
}

/**
 * The bridge subscribes to this with ConvexClient for push delivery. Internal
 * queries can't be subscribed from outside Convex, so this one public query is
 * gated by the bridge secret instead of Convex Auth.
 */
export const pendingOutbox = query({
  args: { bridgeKey: v.string(), lane: outboxLane },
  returns: v.array(outboxDoc),
  handler: async (ctx, { bridgeKey, lane }) => {
    if (!sameSecret(bridgeKey)) throw new Error("Unauthorized");
    return await laneRows(ctx, lane, "pending", 50);
  },
});

export const claimOutbox = internalMutation({
  args: { now: v.number(), leaseMs: v.number(), limit: v.number(), lane: outboxLane },
  returns: v.array(outboxDoc),
  handler: async (ctx, { now, leaseMs, limit, lane }) => {
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error("leaseMs must be positive");
    if (!Number.isInteger(limit) || limit < 0 || limit > 50) throw new Error("limit must be between 0 and 50");
    const convexLane = laneSpec(lane).executor === "convex";
    let busy = false;
    // Expired leases first: a send can't be known to have failed, so it is never retried.
    for (const row of await laneRows(ctx, lane, "claimed", 200)) {
      if ((row.leaseUntil ?? 0) > now) {
        busy = true;
        continue;
      }
      const retry = IDEMPOTENT_KINDS.has(row.payload.kind);
      await ctx.db.patch(row._id, {
        status: retry ? "pending" : "unknown",
        error: retry ? undefined : "bridge stopped before confirming the command",
        leaseUntil: undefined,
        claimToken: undefined,
        updatedAt: now,
      });
      if (!retry && row.payload.kind === "send") {
        await strandPendingSend(ctx, row.clientKey, "failed");
        await laneSpec(lane).onUnknown?.(ctx, row);
      }
    }
    // A convex lane runs one row at a time, like a pull lane's executor; the running drive claims the next.
    if (convexLane && busy) return [];
    const claimed: Doc<"comma_outbox">[] = [];
    for (const row of await laneRows(ctx, lane, "pending", limit)) {
      if (row.conversationId && isTriage(row.payload)) {
        await applyQueuedTriage(ctx, { ...row, conversationId: row.conversationId }, row.payload, now);
        continue;
      }
      if (await expireIfStale(ctx, row, now)) continue;
      if (row.payload.kind === "send") await claimPendingSend(ctx, row.clientKey);
      if (row.conversationId && row.payload.kind === "markRead") await readConversation(ctx, row.conversationId, row.createdAt);
      const patch = { claimToken: `${row._id}:${row.attempts + 1}`, error: undefined, status: "claimed" as const, leaseUntil: now + leaseMs, attempts: row.attempts + 1, updatedAt: now };
      await ctx.db.patch(row._id, patch);
      // If the action holding this claim dies, its lease's expiry starts the next drive.
      if (convexLane) await wakeLane(ctx, lane, patch.leaseUntil + 1);
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
    const patch = { status, leaseUntil: undefined, updatedAt: Date.now(), error, resultGuid, result };
    await ctx.db.patch(row._id, patch);
    const completed = { ...row, ...patch };
    // A convex lane's sent message lands here first, so the pending send retires onto it in this same write.
    const spec = laneOfRow(row);
    if (status === "sent") await spec.onResult?.(ctx, completed);
    if (status === "failed") await spec.onFailed?.(ctx, completed);
    if (row.payload.kind === "send") await completePendingSend(ctx, clientKey, status, resultGuid);
    if (status === "unknown") await spec.onUnknown?.(ctx, completed);
    return true;
  },
});

/** A command whose outcome is unknown, for a lane's check to look for. */
export const unknownSend = internalQuery({
  args: { clientKey: v.string() },
  returns: v.union(outboxDoc, v.null()),
  handler: async (ctx, { clientKey }) => {
    const row = await ctx.db.query("comma_outbox").withIndex("by_clientKey", (q) => q.eq("clientKey", clientKey)).unique();
    return row?.status === "unknown" ? row : null;
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
