import type { ChatSummary } from "@shared/types";
import { describe, expect, test } from "bun:test";

import { classifyToday, planToday, settleAllTargets, todayHeader, toTodayView, type TodayRun, type TodayView } from "./today";

const SNAPSHOT = 1_000_000;
const DAY_START = 500_000;
const done: TodayRun = { status: "done", attempt: 1, source: "schedule", finishedAt: SNAPSHOT + 40_000 };

function chat(id: string, flags: Partial<ChatSummary["flags"]> = {}, extra: Partial<ChatSummary> = {}): ChatSummary {
  return {
    conversationId: id, guid: `g-${id}`, displayName: id, isGroup: false, known: true, isSpam: false, participants: [],
    lastMessage: { guid: `m-${id}`, text: "hi", dateCreated: 1, isFromMe: false, senderName: null, hasAttachments: false },
    unreadCount: 0,
    flags: { unresponded: false, waiting: false, unread: false, mutedUnresponded: false, pinned: false, ...flags },
    ...extra,
  };
}

type Built = { id: string; group: string; reason?: string; anchor?: string };
function view(items: Built[], openAtSnapshot: string[], cleared: Record<string, number> = {}, over: Partial<{ snapshotAt: number; run: TodayRun; candidateCount: number }> = {}): TodayView {
  const row = {
    day: "2026-10-27", dayStart: DAY_START, run: over.run ?? done,
    queue: {
      snapshotAt: over.snapshotAt ?? SNAPSHOT, model: "claude-opus-5-5", brief: "Friday first.", readCount: 81,
      groups: [{ id: "friday", title: "Friday", context: "Set times close tonight." }, { id: "money", title: "Money", context: "" }, { id: "settle", title: "Just settle these", context: "" }],
      items: items.map(({ id, group, reason, anchor }, index) => ({ conversationId: id, group, rank: index + 1, reason: reason ?? `reason ${id}`, ...(anchor === undefined ? {} : { anchor }) })),
      openAtSnapshot,
      ...(over.candidateCount === undefined ? {} : { candidateCount: over.candidateCount }),
    },
    cleared: Object.entries(cleared).map(([conversationId, at]) => ({ conversationId, at })),
  };
  return toTodayView(row as Parameters<typeof toTodayView>[0])!;
}

const needsYou = { unresponded: true };
const waiting = { waiting: true };

describe("classifyToday: the placement table", () => {
  const v = view([{ id: "a", group: "friday" }, { id: "w", group: "money" }], ["a", "b"]);

  test("a ranked thread with a new message keeps its slot", () => {
    expect(classifyToday(v, chat("a", { ...needsYou, unread: true }, { unreadCount: 2 }))).toMatchObject({ at: "ranked", rank: 1, group: "friday" });
  });

  test("a reply removes a queued Needs you and leaves its rank as a gap", () => {
    const replied = view([{ id: "a", group: "friday" }], ["a"], { a: SNAPSHOT + 5 });
    expect(classifyToday(replied, chat("a", waiting))).toEqual({ at: "done", rank: 1, group: "friday", reason: "reason a" });
  });

  test("they answer again after the reply: New since", () => {
    const replied = view([{ id: "a", group: "friday" }], ["a"], { a: SNAPSHOT + 5 });
    expect(classifyToday(replied, chat("a", needsYou))).toEqual({ at: "new" });
  });

  test("a queued Waiting drops out when they answer", () => {
    expect(classifyToday(v, chat("w", waiting))).toMatchObject({ at: "ranked", rank: 2 });
    expect(classifyToday(v, chat("w", needsYou))).toEqual({ at: "new" });
  });

  test("settle, then Undo, returns the thread to the same slot", () => {
    expect(classifyToday(view([{ id: "a", group: "friday" }], ["a"], { a: SNAPSHOT + 9 }), chat("a"))).toMatchObject({ at: "done", rank: 1 });
    expect(classifyToday(view([{ id: "a", group: "friday" }], ["a"]), chat("a", needsYou))).toMatchObject({ at: "ranked", rank: 1 });
  });

  test("a thread that turns Needs you after the build is New since", () => {
    expect(classifyToday(v, chat("c", needsYou))).toEqual({ at: "new" });
  });

  test("a Needs you the build left out is below the line", () => {
    expect(classifyToday(v, chat("b", needsYou))).toEqual({ at: "below" });
    expect(classifyToday(view([], ["b"], { b: SNAPSHOT + 1 }), chat("b", needsYou))).toEqual({ at: "new" });
  });

  test("a clear before the build does not count as handled", () => {
    expect(classifyToday(view([{ id: "a", group: "friday" }], ["a"], { a: SNAPSHOT - 1 }), chat("a", needsYou))).toMatchObject({ at: "ranked" });
  });

  test("a conversation cleared today and not back in Needs you is settled, so the list matches the settled count", () => {
    expect(classifyToday(view([], [], { s: DAY_START + 1 }), chat("s"))).toEqual({ at: "settled", clearedAt: DAY_START + 1 });
    expect(classifyToday(view([], [], { s: DAY_START + 1 }), chat("s", { waiting: true }))).toEqual({ at: "settled", clearedAt: DAY_START + 1 });
    expect(classifyToday(v, chat("z"))).toEqual({ at: "out" });
  });

  test("agent-only and unknown conversations never enter", () => {
    const agent = { attention: "needs_you" as const, chatId: "x", title: "t", openCount: 1, activityAt: 1 };
    expect(classifyToday(v, chat("c", {}, { agent }))).toEqual({ at: "out" });
    expect(classifyToday(v, chat("c", needsYou, { known: false }))).toEqual({ at: "out" });
    expect(classifyToday(v, chat("b", needsYou, { isSpam: true }))).toEqual({ at: "out" });
  });
});

describe("the settle group against the message the build read", () => {
  const v = view([{ id: "t", group: "settle", anchor: "m-t" }, { id: "old", group: "settle" }], ["t", "old"]);
  const urgent = (id: string) => chat(id, needsYou, { lastMessage: { ...chat(id).lastMessage!, guid: `urgent-${id}` } });

  test("an unchanged settle row stays ranked; a new message moves it to New since", () => {
    expect(classifyToday(v, chat("t", needsYou))).toMatchObject({ at: "ranked", group: "settle" });
    expect(classifyToday(v, urgent("t"))).toEqual({ at: "new" });
  });

  test("a settle row stored without an anchor never counts as unchanged", () => {
    expect(classifyToday(v, chat("old", needsYou))).toEqual({ at: "new" });
  });

  test("Settle all takes only unchanged ranked settle rows, each with its stored anchor", () => {
    const handled = view([{ id: "t", group: "settle", anchor: "m-t" }, { id: "h", group: "settle", anchor: "m-h" }], ["t", "h"], { h: SNAPSHOT + 1 });
    const chats = [chat("t", needsYou), chat("h"), chat("old", needsYou)];
    expect(planToday(handled, chats, { held: "g-h" }).sections.find((s) => s.key === "group:settle")?.rows.map((r) => r.chat.conversationId),
      "the held, handled row still displays").toEqual(["t", "h"]);
    expect(settleAllTargets(handled, chats).map(({ chat: c, anchor }) => [c.conversationId, anchor])).toEqual([["t", "m-t"]]);
    expect(settleAllTargets(v, [urgent("t"), chat("old", needsYou)])).toEqual([]);
  });
});

describe("planToday", () => {
  const items = [{ id: "a", group: "friday" }, { id: "b", group: "friday" }, { id: "m", group: "money" }];
  const chats = [
    chat("m", needsYou), chat("b", needsYou), chat("a", needsYou),
    chat("n2", needsYou, { lastMessage: { ...chat("x").lastMessage!, dateCreated: 20 } }),
    chat("n1", needsYou, { lastMessage: { ...chat("x").lastMessage!, dateCreated: 10 } }),
    chat("low", needsYou), chat("s"),
  ];

  test("New since leads newest first, groups follow in build order by rank, folds close the list", () => {
    const plan = planToday(view(items, ["a", "b", "m", "low"], { s: DAY_START + 3 }), chats, { held: null });
    expect(plan.mode).toBe("queue");
    expect(plan.sections.map((s) => [s.key, s.rows.map((r) => r.chat.conversationId)])).toEqual([
      ["new", ["n2", "n1"]], ["group:friday", ["a", "b"]], ["group:money", ["m"]], ["below", ["low"]], ["settled", ["s"]],
    ]);
    expect(plan.sections[0]).toMatchObject({ label: expect.stringMatching(/^New since /), tone: "fresh" });
    expect(plan.sections.filter((s) => s.foldable).map((s) => s.key)).toEqual(["below", "settled"]);
    expect(plan).toMatchObject({ toGo: 5, newSince: 2, settled: 1 });
  });

  test("a settled ranked row leaves its gap and bumps progress", () => {
    const after = chats.map((c) => (c.conversationId === "a" ? chat("a") : c));
    const plan = planToday(view(items, ["a", "b", "m", "low"], { s: DAY_START + 3, a: SNAPSHOT + 1 }), after, { held: null });
    expect(plan.sections.find((s) => s.key === "group:friday")?.rows.map((r) => r.rank)).toEqual([2]);
    expect(plan).toMatchObject({ toGo: 4, settled: 2 });
  });

  test("the held conversation keeps its slot after it is handled, without counting as to go", () => {
    const after = chats.map((c) => (c.conversationId === "a" ? chat("a") : c));
    const plan = planToday(view(items, ["a", "b", "m", "low"], { a: SNAPSHOT + 1 }), after, { held: "g-a" });
    expect(plan.sections.find((s) => s.key === "group:friday")?.rows.map((r) => r.rank)).toEqual([1, 2]);
    expect(plan.toGo).toBe(4);
  });

  test("a conversation held from New since or Below the line stays in that section after a reply, without counting as to go", () => {
    const replied = chats.map((c) => (c.conversationId === "n2" ? { ...c, flags: chat("n2", waiting).flags } : c.conversationId === "low" ? chat("low", waiting) : c));
    const v = view(items, ["a", "b", "m", "low"], { n2: SNAPSHOT + 9, low: SNAPSHOT + 9 });
    const rows = (p: ReturnType<typeof planToday>, key: string) => p.sections.find((s) => s.key === key)?.rows.map((r) => r.chat.conversationId);
    const fromNew = planToday(v, replied, { held: "g-n2", heldSection: "new" });
    expect(rows(fromNew, "new")).toEqual(["n2", "n1"]);
    expect(rows(fromNew, "settled")).toEqual(["low"]);
    expect(fromNew).toMatchObject({ toGo: 4, newSince: 1 });
    const fromBelow = planToday(v, replied, { held: "g-low", heldSection: "below" });
    expect(rows(fromBelow, "below")).toEqual(["low"]);
    expect(rows(fromBelow, "settled")).toEqual(["n2"]);
    expect(fromBelow.toGo).toBe(4);
    expect(rows(planToday(v, replied, { held: null }), "settled")).toEqual(["n2", "low"]);
  });

  test("progress carries across a Regenerate: a newer snapshot changes the plan, not the settled count", () => {
    const cleared = { s: DAY_START + 3, a: SNAPSHOT + 1 };
    const before = planToday(view(items, ["a", "b", "m", "low"], cleared), chats, { held: null });
    const rebuilt = planToday(view([{ id: "b", group: "friday" }], ["b", "low"], cleared, { snapshotAt: SNAPSHOT + 100 }), chats, { held: null });
    expect(rebuilt.settled).toBe(before.settled);
  });

  test("without a queue today, one Needs you section in its usual order", () => {
    const pinned = chat("p", needsYou, { flags: { ...chat("p").flags, unresponded: true, pinned: true } });
    const plan = planToday(null, [chat("x", needsYou), pinned, chat("q")], { held: null });
    expect(plan.mode).toBe("fallback");
    expect(plan.sections.map((s) => [s.label, s.rows.map((r) => r.chat.conversationId)])).toEqual([["Needs you", ["p", "x"]]]);
    expect(plan.toGo).toBe(2);
  });

  test("without a queue today, the held conversation stays after a reply without counting as to go", () => {
    const plan = planToday(null, [chat("x", needsYou), chat("h", waiting)], { held: "g-h" });
    expect(plan.sections[0]?.rows.map((r) => r.chat.conversationId)).toEqual(["x", "h"]);
    expect(plan.toGo).toBe(1);
  });
});

describe("todayHeader", () => {
  const plan = (v: TodayView | null) => planToday(v, [chat("a", needsYou)], { held: null });

  test("loading, unbuilt and failed before today's first queue", () => {
    expect(todayHeader(undefined, plan(null))).toEqual({ kind: "loading" });
    expect(todayHeader(null, plan(null))).toEqual({ kind: "unbuilt", busy: null });
    const failed = { ...view([], []), queue: null, run: { status: "failed", attempt: 1, source: "schedule", failedAt: 7, error: "The gateway timed out" } } as TodayView;
    expect(todayHeader(failed, plan(failed))).toEqual({ kind: "failed", error: "The gateway timed out", failedAt: 7, busy: null });
  });

  test("a Regenerate in flight keeps the queue and reports busy; a failed one keeps it with the error", () => {
    const building = view([{ id: "a", group: "friday" }], ["a"], {}, { run: { status: "building", attempt: 2, source: "user", requestedAt: 1, startedAt: 2, claimId: "w1" } });
    expect(todayHeader(building, plan(building))).toMatchObject({ kind: "queue", busy: "building", queued: 1, readCount: 81, model: "Opus 5.5", lastError: null });
    const failed = view([{ id: "a", group: "friday" }], ["a"], {}, { run: { status: "failed", attempt: 2, source: "user", failedAt: 3, error: "The answer didn't parse" } });
    expect(todayHeader(failed, plan(failed))).toMatchObject({ kind: "queue", busy: null, lastError: "The answer didn't parse" });
  });

  test("the header reads what was read against every candidate, and an older queue against its Needs you", () => {
    const counted = view([{ id: "a", group: "friday" }], ["a", "b"], {}, { candidateCount: 335 });
    expect(todayHeader(counted, plan(counted))).toMatchObject({ readCount: 81, candidateCount: 335 });
    const older = view([{ id: "a", group: "friday" }], ["a", "b"]);
    expect(todayHeader(older, plan(older))).toMatchObject({ candidateCount: 2 });
  });

  test("the queue is cleared once no ranked rows remain, New since still named", () => {
    const v = view([{ id: "a", group: "friday" }], ["a"], { a: SNAPSHOT + 1 });
    const p = planToday(v, [chat("a"), chat("n", needsYou)], { held: null });
    expect(todayHeader(v, p)).toMatchObject({ kind: "queue", cleared: true, newSince: 1, toGo: 1, settled: 1 });
  });
});
