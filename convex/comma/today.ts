import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { knownParticipants } from "../../apps/imsg/shared/chat-state";
import { todayCandidateState, todayWindow } from "../../apps/imsg/shared/today";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";
import { todayCandidate, todayQueue, todayRun, todayView, type TodayCandidate, type TodayRun } from "../schema/comma/validators";

import { sameSecret } from "./bridgeAuth";
import { listReader, withConversationState } from "./queries";

/**
 * The Today queue: one row per LA day. `run` is the latest build attempt and `queue` the latest
 * successful one, so a Regenerate in flight or a failed one never takes the day's queue away.
 * Every run transition is fenced by `run.attempt`. See apps/imsg/docs/today-queue.md.
 */

const REQUEST_EXPIRY_MS = 10 * 60_000;
const BUILD_EXPIRY_MS = 8 * 60_000;
const EXPIRED = { requested: "The Mini didn't pick it up", building: "The build timed out" } as const;

const expireRunRef = makeFunctionReference<"mutation", { day: string; attempt: number; status: "requested" | "building" }, null>(
  "comma/today:expireRun",
);

async function rowFor(ctx: QueryCtx, day: string): Promise<Doc<"comma_today_queue"> | null> {
  return await ctx.db.query("comma_today_queue").withIndex("by_day", (q) => q.eq("day", day)).unique();
}

function assertDay(day: string, dayStart: number) {
  const window = todayWindow(dayStart);
  if (window.day !== day || window.start !== dayStart) throw new Error("day and dayStart disagree");
}

/** Starts a new attempt unless one is already queued or running. Creates the day's row on first use. */
async function request(ctx: MutationCtx, day: string, dayStart: number, source: TodayRun["source"]): Promise<TodayRun> {
  const row = await rowFor(ctx, day);
  if (row && (row.run.status === "requested" || row.run.status === "building")) return row.run;
  const run: TodayRun = { status: "requested", attempt: (row?.run.attempt ?? 0) + 1, source, requestedAt: Date.now() };
  if (row) await ctx.db.patch(row._id, { run });
  else await ctx.db.insert("comma_today_queue", { day, dayStart, run });
  await ctx.scheduler.runAfter(REQUEST_EXPIRY_MS, expireRunRef, { day, attempt: run.attempt, status: "requested" });
  return run;
}

/** The day's row with the clear log since dayStart, or null before anything was requested. */
export const get = query({
  args: { day: v.string() },
  returns: v.union(todayView, v.null()),
  handler: async (ctx, { day }) => {
    await assertAllowed(ctx);
    const row = await rowFor(ctx, day);
    if (!row) return null;
    const events = await ctx.db.query("comma_triage_events")
      .withIndex("by_clearedAt", (q) => q.gte("clearedAt", row.dayStart))
      .collect();
    const latest = new Map<Id<"comma_conversations">, number>();
    for (const event of events) latest.set(event.conversationId, Math.max(latest.get(event.conversationId) ?? 0, event.clearedAt));
    return {
      day: row.day, dayStart: row.dayStart, run: row.run, queue: row.queue ?? null,
      cleared: [...latest].map(([conversationId, at]) => ({ conversationId, at })),
    };
  },
});

/** Regenerate. A no-op while a build is queued or running; otherwise the next attempt. */
export const requestBuild = mutation({
  args: { day: v.string(), dayStart: v.number() },
  returns: todayRun,
  handler: async (ctx, { day, dayStart }) => {
    await assertAllowed(ctx);
    assertDay(day, dayStart);
    return await request(ctx, day, dayStart, "user");
  },
});

/** The Mini subscribes to this with ConvexClient, so it is gated by the bridge secret instead of Convex Auth. */
export const pendingBuild = query({
  args: { bridgeKey: v.string() },
  returns: v.union(v.object({ day: v.string(), attempt: v.number() }), v.null()),
  handler: async (ctx, { bridgeKey }) => {
    if (!sameSecret(bridgeKey)) throw new Error("Unauthorized");
    const row = await ctx.db.query("comma_today_queue").withIndex("by_day").order("desc").first();
    return row?.run.status === "requested" ? { day: row.day, attempt: row.run.attempt } : null;
  },
});

// Ingest routes. They are mutations because the ingest route runs mutations.

/** The 7:00 AM trigger. Requests only when the day has no row yet; every call returns the current run. */
export const todaySchedule = internalMutation({
  args: { day: v.string(), dayStart: v.number() },
  returns: todayRun,
  handler: async (ctx, { day, dayStart }) => {
    assertDay(day, dayStart);
    return (await rowFor(ctx, day))?.run ?? await request(ctx, day, dayStart, "schedule");
  },
});

/**
 * requested(attempt) → building. startedAt is the snapshot time; null means another claim owns the day.
 * A retry carrying the same claimId gets its startedAt back, so a lost response cannot fence out its own worker.
 */
export const todayClaim = internalMutation({
  args: { day: v.string(), attempt: v.number(), claimId: v.string() },
  returns: v.union(v.object({ startedAt: v.number() }), v.null()),
  handler: async (ctx, { day, attempt, claimId }) => {
    const row = await rowFor(ctx, day);
    if (!row || row.run.attempt !== attempt) return null;
    if (row.run.status === "building") return row.run.claimId === claimId ? { startedAt: row.run.startedAt } : null;
    if (row.run.status !== "requested") return null;
    const startedAt = Date.now();
    await ctx.db.patch(row._id, { run: { ...row.run, status: "building", startedAt, claimId } });
    await ctx.scheduler.runAfter(BUILD_EXPIRY_MS, expireRunRef, { day, attempt, status: "building" });
    return { startedAt };
  },
});

/** One page of build candidates, newest first, projected the way listConversations is. */
export const todayCandidates = internalMutation({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  returns: v.object({ page: v.array(todayCandidate), continueCursor: v.string(), isDone: v.boolean() }),
  handler: async (ctx, { cursor, numItems }) => {
    const now = Date.now();
    const result = await ctx.db.query("comma_conversations")
      .withIndex("by_lastMessageAt")
      .order("desc")
      .filter((q) => q.neq(q.field("lastMessage"), undefined))
      .paginate({ cursor, numItems });
    const read = listReader(ctx);
    const page: TodayCandidate[] = [];
    for (const conversation of result.page) {
      const view = await withConversationState(ctx, conversation, read);
      const state = todayCandidateState({ ...view, known: knownParticipants(view.participants) }, now);
      if (!state) continue;
      page.push({
        conversationId: view._id, title: view.displayName, isGroup: view.isGroup, state,
        lastMessageAt: view.lastMessageAt, unreadCount: view.unreadCount, ...(view.crm ? { crm: view.crm } : {}),
      });
    }
    return { page, continueCursor: result.continueCursor, isDone: result.isDone };
  },
});

/** building(attempt) → done or failed. A replay of the outcome that already landed answers true and writes nothing. */
export const todayFinish = internalMutation({
  args: {
    day: v.string(),
    attempt: v.number(),
    outcome: v.union(v.object({ ok: v.literal(true), queue: todayQueue }), v.object({ ok: v.literal(false), error: v.string() })),
  },
  returns: v.boolean(),
  handler: async (ctx, { day, attempt, outcome }) => {
    const row = await rowFor(ctx, day);
    if (!row || row.run.attempt !== attempt) return false;
    const { run } = row;
    if (run.status === "done") return outcome.ok;
    if (run.status === "failed") return !outcome.ok;
    if (run.status !== "building") return false;
    const { source } = run;
    if (outcome.ok) {
      await ctx.db.patch(row._id, { run: { status: "done", attempt, source, finishedAt: Date.now() }, queue: outcome.queue });
    } else {
      await ctx.db.patch(row._id, { run: { status: "failed", attempt, source, failedAt: Date.now(), error: outcome.error } });
    }
    return true;
  },
});

/** Scheduled at request and at claim: a live query cannot notice time passing, so a stuck run fails here. */
export const expireRun = internalMutation({
  args: { day: v.string(), attempt: v.number(), status: v.union(v.literal("requested"), v.literal("building")) },
  returns: v.null(),
  handler: async (ctx, { day, attempt, status }) => {
    const row = await rowFor(ctx, day);
    if (!row || row.run.status !== status || row.run.attempt !== attempt) return null;
    await ctx.db.patch(row._id, {
      run: { status: "failed", attempt, source: row.run.source, failedAt: Date.now(), error: EXPIRED[status] },
    });
    return null;
  },
});
