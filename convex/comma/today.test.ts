import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { todayWindow } from "../../apps/imsg/shared/today";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";
import type { TodayQueue } from "../schema/comma/validators";

import { commaModules } from "./testModules.vitest";

const SECRET = "bridge-secret";
const previous = process.env.COMMA_BRIDGE_SECRET;
beforeEach(() => {
  process.env.COMMA_BRIDGE_SECRET = SECRET;
});
afterEach(() => {
  if (previous === undefined) delete process.env.COMMA_BRIDGE_SECRET;
  else process.env.COMMA_BRIDGE_SECRET = previous;
});

const { day, start: dayStart } = todayWindow(Date.parse("2026-10-27T15:00:00Z"));
const tomorrow = todayWindow(dayStart + 30 * 3_600_000);
const DAY = 86_400_000;

function setup() {
  const t = convexTest(schema, commaModules);
  return { t, as: t.withIdentity({ email: ALLOWED_EMAIL }) };
}

function conversation(key: string, over: Partial<Doc<"comma_conversations">> = {}): Omit<Doc<"comma_conversations">, "_id" | "_creationTime"> {
  const at = over.lastMessageAt ?? Date.now() - 60_000;
  return {
    conversationKey: `dm:${key}`, primaryChatGuid: `iMessage;-;${key}`, chatGuids: [`iMessage;-;${key}`],
    displayName: key, isGroup: false, participants: [{ address: key, name: key }],
    lastMessage: { guid: `last-${key}`, text: "hi", dateCreated: at, isFromMe: false, senderName: key, hasAttachments: false },
    lastMessageAt: at, isSpam: false, hasGroupPhoto: false, updatedAt: at, ...over,
  };
}

function queue(snapshotAt: number, ids: Id<"comma_conversations">[], session?: TodayQueue["session"]): TodayQueue {
  return {
    snapshotAt, model: "claude-opus-5-5", brief: "Friday first.", readCount: ids.length,
    groups: [{ id: "g1", title: "Friday", context: "Set times close tonight." }],
    items: ids.map((conversationId, index) => ({ conversationId, rank: index + 1, group: "g1", reason: "Blocks the run of show.", anchor: `m${index}` })),
    openAtSnapshot: ids,
    ...(session ? { session } : {}),
  };
}

async function runOf(t: ReturnType<typeof setup>["t"], key = day) {
  return (await t.run((ctx) => ctx.db.query("comma_today_queue").withIndex("by_day", (q) => q.eq("day", key)).unique()))?.run;
}

describe("requestBuild", () => {
  test("is a no-op while requested or building, and starts the next attempt after done or failed", async () => {
    const { t, as } = setup();
    expect(await as.mutation(api.comma.today.requestBuild, { day, dayStart })).toMatchObject({ status: "requested", attempt: 1, source: "user" });
    expect(await as.mutation(api.comma.today.requestBuild, { day, dayStart })).toMatchObject({ status: "requested", attempt: 1 });
    await t.mutation(internal.comma.today.todayClaim, { day, attempt: 1, claimId: "w1" });
    expect(await as.mutation(api.comma.today.requestBuild, { day, dayStart })).toMatchObject({ status: "building", attempt: 1 });
    await t.mutation(internal.comma.today.todayFinish, { day, attempt: 1, outcome: { ok: false, error: "The gateway timed out" } });
    expect(await as.mutation(api.comma.today.requestBuild, { day, dayStart })).toMatchObject({ status: "requested", attempt: 2 });
    await t.mutation(internal.comma.today.todayClaim, { day, attempt: 2, claimId: "w2" });
    await t.mutation(internal.comma.today.todayFinish, { day, attempt: 2, outcome: { ok: true, queue: queue(1, []) } });
    expect(await as.mutation(api.comma.today.requestBuild, { day, dayStart })).toMatchObject({ status: "requested", attempt: 3 });
  });

  test("stores the mode, and a request without one is a Regenerate", async () => {
    const { t, as } = setup();
    expect(await as.mutation(api.comma.today.requestBuild, { day, dayStart })).toMatchObject({ status: "requested", mode: "fresh" });
    await t.mutation(internal.comma.today.todayClaim, { day, attempt: 1, claimId: "w1" });
    await t.mutation(internal.comma.today.todayFinish, { day, attempt: 1, outcome: { ok: true, queue: queue(1, []) } });
    expect(await runOf(t), "finish carries the mode through").toMatchObject({ status: "done", mode: "fresh" });
    expect(await as.mutation(api.comma.today.requestBuild, { day, dayStart, mode: "update" })).toMatchObject({ status: "requested", attempt: 2, mode: "update" });
    await t.mutation(internal.comma.today.expireRun, { day, attempt: 2, status: "requested" });
    expect(await runOf(t), "expiry carries the mode through").toMatchObject({ status: "failed", mode: "update" });
  });

  test("rejects a dayStart that is not that day's midnight", async () => {
    const { as } = setup();
    await expect(as.mutation(api.comma.today.requestBuild, { day, dayStart: dayStart + 1 })).rejects.toThrow("disagree");
  });

  test("rejects unauthenticated callers", async () => {
    const { t } = setup();
    await expect(t.mutation(api.comma.today.requestBuild, { day, dayStart })).rejects.toThrow("Unauthorized");
    await expect(t.query(api.comma.today.get, { day })).rejects.toThrow("Unauthorized");
  });
});

describe("todaySchedule", () => {
  test("requests only for a day without a row and answers the current run on every poll", async () => {
    const { t } = setup();
    expect(await t.mutation(internal.comma.today.todaySchedule, { day, dayStart })).toMatchObject({ status: "requested", attempt: 1, source: "schedule", mode: "update" });
    expect(await t.mutation(internal.comma.today.todaySchedule, { day, dayStart })).toMatchObject({ status: "requested", attempt: 1 });
    await t.mutation(internal.comma.today.todayClaim, { day, attempt: 1, claimId: "w1" });
    await t.mutation(internal.comma.today.todayFinish, { day, attempt: 1, outcome: { ok: false, error: "The AI gateway is down" } });
    expect(await t.mutation(internal.comma.today.todaySchedule, { day, dayStart })).toMatchObject({ status: "failed", attempt: 1 });
    expect(await t.mutation(internal.comma.today.todaySchedule, { day: tomorrow.day, dayStart: tomorrow.start })).toMatchObject({ status: "requested", attempt: 1 });
  });
});

describe("todaySchedule after an overnight build", () => {
  test("a build Milad ran before 7:00 AM still gets the morning build, once", async () => {
    const { t, as } = setup();
    // Two days ahead of the real clock, so the build always ends before that day's 7:00 AM.
    const ahead = todayWindow(Date.now() + 2 * DAY);
    const next = { day: ahead.day, dayStart: ahead.start };
    await as.mutation(api.comma.today.requestBuild, next);
    await t.mutation(internal.comma.today.todayClaim, { day: ahead.day, attempt: 1, claimId: "w1" });
    await t.mutation(internal.comma.today.todayFinish, { day: ahead.day, attempt: 1, outcome: { ok: false, error: "x" } });
    expect(await t.mutation(internal.comma.today.todaySchedule, next)).toMatchObject({ status: "requested", attempt: 2, source: "schedule" });
    expect(await t.mutation(internal.comma.today.todaySchedule, next)).toMatchObject({ status: "requested", attempt: 2 });
  });
});

describe("claim and finish", () => {
  test("claim is fenced by attempt and status", async () => {
    const { t, as } = setup();
    await as.mutation(api.comma.today.requestBuild, { day, dayStart });
    expect(await t.mutation(internal.comma.today.todayClaim, { day, attempt: 2, claimId: "w2" })).toBeNull();
    expect(await t.mutation(internal.comma.today.todayClaim, { day, attempt: 1, claimId: "w1" })).toEqual({ startedAt: expect.any(Number), mode: "fresh", basis: null });
    expect(await t.mutation(internal.comma.today.todayClaim, { day, attempt: 1, claimId: "other" })).toBeNull();
    expect(await runOf(t)).toMatchObject({ status: "building", attempt: 1, claimId: "w1" });
  });

  test("a retried claim with the same claimId gets its startedAt back", async () => {
    const { t, as } = setup();
    await as.mutation(api.comma.today.requestBuild, { day, dayStart });
    const first = await t.mutation(internal.comma.today.todayClaim, { day, attempt: 1, claimId: "w1" });
    expect(await t.mutation(internal.comma.today.todayClaim, { day, attempt: 1, claimId: "w1" })).toEqual(first);
    await t.mutation(internal.comma.today.todayFinish, { day, attempt: 1, outcome: { ok: false, error: "x" } });
    expect(await t.mutation(internal.comma.today.todayClaim, { day, attempt: 1, claimId: "w1" })).toBeNull();
  });

  test("finish lands once, replays as a no-op, and a stale attempt cannot overwrite", async () => {
    const { t, as } = setup();
    const c = await t.run((ctx) => ctx.db.insert("comma_conversations", conversation("alex")));
    await as.mutation(api.comma.today.requestBuild, { day, dayStart });
    await t.mutation(internal.comma.today.todayClaim, { day, attempt: 1, claimId: "w1" });
    const done = { day, attempt: 1, outcome: { ok: true as const, queue: queue(5, [c]) } };
    expect(await t.mutation(internal.comma.today.todayFinish, done)).toBe(true);
    expect((await as.query(api.comma.today.get, { day }))?.queue?.items[0]?.anchor, "the item keeps the message the build read").toBe("m0");
    expect(await t.mutation(internal.comma.today.todayFinish, done)).toBe(true);
    expect(await t.mutation(internal.comma.today.todayFinish, { day, attempt: 1, outcome: { ok: false, error: "late" } })).toBe(false);
    expect(await runOf(t)).toMatchObject({ status: "done", attempt: 1 });

    await as.mutation(api.comma.today.requestBuild, { day, dayStart });
    await t.mutation(internal.comma.today.todayClaim, { day, attempt: 2, claimId: "w2" });
    expect(await t.mutation(internal.comma.today.todayFinish, { day, attempt: 1, outcome: { ok: true, queue: queue(9, []) } })).toBe(false);
    expect(await t.mutation(internal.comma.today.todayFinish, { day, attempt: 2, outcome: { ok: false, error: "The answer didn't parse" } })).toBe(true);
    const view = await as.query(api.comma.today.get, { day });
    expect(view?.run).toMatchObject({ status: "failed", attempt: 2, error: "The answer didn't parse" });
    expect(view?.queue?.snapshotAt).toBe(5);
  });
  test("a build abandoned after it failed cannot land its queue later", async () => {
    const { t, as } = setup();
    await as.mutation(api.comma.today.requestBuild, { day, dayStart });
    await t.mutation(internal.comma.today.todayClaim, { day, attempt: 1, claimId: "w1" });
    expect(await t.mutation(internal.comma.today.todayFinish, { day, attempt: 1, outcome: { ok: false, error: "The build timed out" } })).toBe(true);
    expect(await t.mutation(internal.comma.today.todayFinish, { day, attempt: 1, outcome: { ok: true, queue: queue(5, []) } })).toBe(false);
    expect((await as.query(api.comma.today.get, { day }))?.queue).toBeNull();
  });
});

describe("the claim's session basis", () => {
  async function build(t: ReturnType<typeof setup>["t"], as: ReturnType<typeof setup>["as"], at: { day: string; dayStart: number }, q: TodayQueue, mode: "update" | "fresh" = "update") {
    const run = await as.mutation(api.comma.today.requestBuild, { ...at, mode });
    await t.mutation(internal.comma.today.todayClaim, { day: at.day, attempt: run.attempt, claimId: `w${run.attempt}` });
    await t.mutation(internal.comma.today.todayFinish, { day: at.day, attempt: run.attempt, outcome: { ok: true, queue: q } });
  }

  test("an Update gets this day's session, and a retried claim gets the same answer", async () => {
    const { t, as } = setup();
    await build(t, as, { day, dayStart }, queue(50, [], { id: "s1", startedAt: 40, updates: 1 }));
    await as.mutation(api.comma.today.requestBuild, { day, dayStart, mode: "update" });
    const claim = await t.mutation(internal.comma.today.todayClaim, { day, attempt: 2, claimId: "w2" });
    expect(claim).toEqual({ startedAt: expect.any(Number), mode: "update", basis: { sessionId: "s1", snapshotAt: 50 } });
    expect(await t.mutation(internal.comma.today.todayClaim, { day, attempt: 2, claimId: "w2" })).toEqual(claim);
  });

  test("with no queue today yet, the morning Update continues the previous day's session", async () => {
    const { t, as } = setup();
    const yesterday = todayWindow(dayStart - 1);
    const earlier = todayWindow(yesterday.start - 1);
    await build(t, as, { day: earlier.day, dayStart: earlier.start }, queue(10, [], { id: "old", startedAt: 10, updates: 0 }));
    await build(t, as, { day: yesterday.day, dayStart: yesterday.start }, queue(20, [], { id: "s1", startedAt: 10, updates: 3 }));
    await build(t, as, { day: tomorrow.day, dayStart: tomorrow.start }, queue(90, [], { id: "later", startedAt: 90, updates: 0 }));
    await t.mutation(internal.comma.today.todaySchedule, { day, dayStart });
    expect(await t.mutation(internal.comma.today.todayClaim, { day, attempt: 1, claimId: "w1" }))
      .toMatchObject({ mode: "update", basis: { sessionId: "s1", snapshotAt: 20 } });
  });

  test("the basis is null for a Regenerate, and when no queue has a session", async () => {
    const { t, as } = setup();
    const yesterday = todayWindow(dayStart - 1);
    await build(t, as, { day: yesterday.day, dayStart: yesterday.start }, queue(20, []));
    await as.mutation(api.comma.today.requestBuild, { day, dayStart, mode: "update" });
    expect(await t.mutation(internal.comma.today.todayClaim, { day, attempt: 1, claimId: "w1" })).toMatchObject({ mode: "update", basis: null });
    await t.mutation(internal.comma.today.todayFinish, { day, attempt: 1, outcome: { ok: true, queue: queue(30, [], { id: "s1", startedAt: 30, updates: 0 }) } });
    await as.mutation(api.comma.today.requestBuild, { day, dayStart, mode: "fresh" });
    expect(await t.mutation(internal.comma.today.todayClaim, { day, attempt: 2, claimId: "w2" })).toMatchObject({ mode: "fresh", basis: null });
  });

  test("a Regenerate whose queue has no session ends the previous day's session", async () => {
    const { t, as } = setup();
    const yesterday = todayWindow(dayStart - 1);
    await build(t, as, { day: yesterday.day, dayStart: yesterday.start }, queue(20, [], { id: "s1", startedAt: 10, updates: 3 }));
    await build(t, as, { day, dayStart }, queue(30, []), "fresh");
    await as.mutation(api.comma.today.requestBuild, { day, dayStart, mode: "update" });
    expect(await t.mutation(internal.comma.today.todayClaim, { day, attempt: 2, claimId: "w2" })).toMatchObject({ mode: "update", basis: null });
  });

  test("a run stored before modes claims as fresh, and finishes without one", async () => {
    const { t } = setup();
    await t.run((ctx) => ctx.db.insert("comma_today_queue", { day, dayStart, run: { status: "requested", attempt: 1, source: "user", requestedAt: 1 } }));
    expect(await t.mutation(internal.comma.today.todayClaim, { day, attempt: 1, claimId: "w1" })).toMatchObject({ mode: "fresh", basis: null });
    await t.mutation(internal.comma.today.todayFinish, { day, attempt: 1, outcome: { ok: false, error: "x" } });
    expect(await runOf(t)).toEqual({ status: "failed", attempt: 1, source: "user", failedAt: expect.any(Number), error: "x" });
  });
});

describe("expireRun", () => {
  test("fails only the matching stuck run", async () => {
    const { t, as } = setup();
    await as.mutation(api.comma.today.requestBuild, { day, dayStart });
    await t.mutation(internal.comma.today.expireRun, { day, attempt: 1, status: "building" });
    await t.mutation(internal.comma.today.expireRun, { day, attempt: 2, status: "requested" });
    expect(await runOf(t)).toMatchObject({ status: "requested", attempt: 1 });
    await t.mutation(internal.comma.today.expireRun, { day, attempt: 1, status: "requested" });
    expect(await runOf(t)).toMatchObject({ status: "failed", error: "The Mini didn't pick it up" });

    await as.mutation(api.comma.today.requestBuild, { day, dayStart });
    await t.mutation(internal.comma.today.todayClaim, { day, attempt: 2, claimId: "w2" });
    await t.mutation(internal.comma.today.expireRun, { day, attempt: 2, status: "building" });
    expect(await runOf(t)).toMatchObject({ status: "failed", attempt: 2, error: "The build timed out" });
  });
});

describe("get", () => {
  test("returns null before anything was requested", async () => {
    const { as } = setup();
    expect(await as.query(api.comma.today.get, { day })).toBeNull();
  });

  test("carries the latest clear per conversation since dayStart, and an undone clear drops out", async () => {
    const { t, as } = setup();
    const [a, b, c] = await t.run(async (ctx) => Promise.all(["a", "b", "c"].map((key) => ctx.db.insert("comma_conversations", conversation(key)))));
    await as.mutation(api.comma.today.requestBuild, { day, dayStart });
    const undone = await t.run(async (ctx) => {
      const event = (conversationId: Id<"comma_conversations">, clearedAt: number) =>
        ctx.db.insert("comma_triage_events", { conversationId, messageGuid: "m", reason: "dismiss", clearedAt });
      await event(a, dayStart - 1);
      await event(a, dayStart + 10);
      await event(a, dayStart + 30);
      await event(b, dayStart - 5);
      return await event(c, dayStart + 20);
    });
    await t.run((ctx) => ctx.db.delete(undone));
    const view = await as.query(api.comma.today.get, { day });
    expect(view?.cleared).toEqual([{ conversationId: a, at: dayStart + 30 }]);
    expect(view?.queue).toBeNull();
  });
});

describe("pendingBuild", () => {
  test("rejects a bad bridge key and shows only a requested run on the newest day", async () => {
    const { t, as } = setup();
    await expect(t.query(api.comma.today.pendingBuild, { bridgeKey: "nope" })).rejects.toThrow("Unauthorized");
    expect(await t.query(api.comma.today.pendingBuild, { bridgeKey: SECRET })).toBeNull();
    await as.mutation(api.comma.today.requestBuild, { day, dayStart });
    expect(await t.query(api.comma.today.pendingBuild, { bridgeKey: SECRET })).toEqual({ day, attempt: 1 });
    await t.mutation(internal.comma.today.todayClaim, { day, attempt: 1, claimId: "w1" });
    expect(await t.query(api.comma.today.pendingBuild, { bridgeKey: SECRET })).toBeNull();
  });
});

describe("todayCandidates", () => {
  test("pages newest first and keeps known Needs you at any age and recent Waiting", async () => {
    const { t } = setup();
    const now = Date.now();
    const outbound = (key: string, at: number) => conversation(key, {
      lastMessageAt: at, lastMessage: { guid: `last-${key}`, text: "you", dateCreated: at, isFromMe: true, senderName: null, hasAttachments: false },
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("comma_conversations", conversation("old-needs", { lastMessageAt: now - 60 * DAY }));
      await ctx.db.insert("comma_conversations", outbound("recent-wait", now - 2 * DAY));
      await ctx.db.insert("comma_conversations", outbound("stale-wait", now - 31 * DAY));
      await ctx.db.insert("comma_conversations", conversation("stranger", { participants: [{ address: "+1555", name: null }] }));
      await ctx.db.insert("comma_conversations", conversation("spam", { isSpam: true }));
      await ctx.db.insert("comma_conversations", conversation("fresh", { lastMessageAt: now - 1000 }));
    });
    const seen: { title: string; state: string }[] = [];
    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
      const result: { page: { title: string; state: string }[]; continueCursor: string; isDone: boolean } =
        await t.mutation(internal.comma.today.todayCandidates, { cursor, numItems: 2 });
      seen.push(...result.page.map(({ title, state }) => ({ title, state })));
      pages++;
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    expect(pages).toBeGreaterThan(1);
    expect(seen).toEqual([
      { title: "fresh", state: "needsYou" },
      { title: "recent-wait", state: "waiting" },
      { title: "old-needs", state: "needsYou" },
    ]);
  });
});
