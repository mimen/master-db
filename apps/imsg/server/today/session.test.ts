import type { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import type { GatewayResult, StructuredOptions } from "../ai/gateway";
import { OverlayDb } from "../db";
import type { ConversationId, TodayCandidate } from "./prompt";
import { compactSession, planUpdate, type TodaySession } from "./session";

const SNAPSHOT = 10_000_000;

function candidate(n: number, state: TodayCandidate["state"], lastMessageAt: number): TodayCandidate {
  return { conversationId: `conv${n}` as ConversationId, title: `Person ${n}`, isGroup: false, state, lastMessageAt, unreadCount: 0 };
}

function session(over: Partial<TodaySession> = {}): TodaySession {
  return {
    id: "s1", startedAt: SNAPSHOT - 1_000, snapshotAt: SNAPSHOT, arrivalsSince: SNAPSHOT, day: "2026-10-27", updates: 1, system: "rules",
    turns: [{ role: "user", content: "read these" }, { role: "assistant", content: '{"brief":"b","groups":[],"items":[{"ref":"c1"}]}' }],
    tokens: 60_000, compactions: 0, nextRef: 10, threads: {}, items: [], ...over,
  };
}

const ids = (list: readonly TodayCandidate[]) => list.map((c) => c.conversationId);

describe("planUpdate", () => {
  test("fresh is a known thread with a new message or a changed state, and an unknown thread after the snapshot, newest first", () => {
    const s = session({
      threads: {
        conv1: { ref: "c1", lastMessageAt: SNAPSHOT - 50, state: "needsYou" },
        conv2: { ref: "c2", lastMessageAt: SNAPSHOT - 40, state: "needsYou" },
        conv3: { ref: "c3", lastMessageAt: SNAPSHOT - 30, state: "needsYou" },
      },
    });
    const plan = planUpdate(s, [
      candidate(1, "needsYou", SNAPSHOT + 5),
      candidate(2, "waiting", SNAPSHOT - 40),
      candidate(3, "needsYou", SNAPSHOT - 30),
      candidate(4, "waiting", SNAPSHOT + 9),
      candidate(5, "needsYou", SNAPSHOT - 1),
    ], new Map(), false);
    expect(ids(plan.fresh)).toEqual(["conv4", "conv1", "conv2"] as ConversationId[]);
    expect(ids(plan.deeper), "an unknown thread from before the snapshot is backlog, not news").toEqual(["conv5"] as ConversationId[]);
  });

  test("fresh stops at 100 and says it was cut", () => {
    const list = Array.from({ length: 120 }, (_, n) => candidate(n, "needsYou", SNAPSHOT + 1 + n));
    const plan = planUpdate(session(), list, new Map(), false);
    expect(plan.fresh).toHaveLength(100);
    expect(plan.fresh[0]?.conversationId).toBe("conv119" as ConversationId);
    expect(plan.freshCut).toBe(true);
    expect(plan.deeper, "news past the cap is not backlog").toEqual([]);
    expect(planUpdate(session(), list.slice(0, 100), new Map(), false).freshCut).toBe(false);
  });

  test("an unknown thread is an arrival by arrivalsSince, not the snapshot", () => {
    const plan = planUpdate(session({ arrivalsSince: SNAPSHOT - 100 }), [candidate(1, "waiting", SNAPSHOT - 50)], new Map(), false);
    expect(ids(plan.fresh)).toEqual(["conv1"] as ConversationId[]);
  });

  test("a pick Milad replied to is no longer open, so its slot is room", () => {
    const s = session({
      items: ["conv1", "conv2"],
      threads: { conv1: { ref: "c1", lastMessageAt: 1, state: "needsYou" }, conv2: { ref: "c2", lastMessageAt: 1, state: "needsYou" } },
    });
    const plan = planUpdate(s, [candidate(1, "waiting", 2), candidate(2, "needsYou", 1)], new Map(), false);
    expect(plan.open).toBe(1);
    expect(plan.room).toBe(49);
  });

  test("gone names known threads that left the candidates; open counts the picks still there, and room is the rest of 50", () => {
    const s = session({
      threads: {
        conv1: { ref: "c1", lastMessageAt: 1, state: "needsYou" },
        conv2: { ref: "c2", lastMessageAt: 1, state: "needsYou" },
        conv3: { ref: "c7", lastMessageAt: 1, state: "waiting" },
      },
      items: ["conv1", "conv2", "conv3"],
    });
    const plan = planUpdate(s, [candidate(1, "needsYou", 1)], new Map(), false);
    expect(plan.gone).toEqual(["c2", "c7"]);
    expect(plan.open).toBe(1);
    expect(plan.room).toBe(49);
  });

  test("deeper reads three unread Needs you per open slot, least recently read first, then newest, and never Waiting", () => {
    const items = Array.from({ length: 46 }, (_, n) => `conv${n}`);
    const picks = items.map((_, n) => candidate(n, "needsYou", n));
    const backlog = Array.from({ length: 20 }, (_, n) => candidate(100 + n, "needsYou", 1_000 + n));
    const s = session({ items, threads: Object.fromEntries(items.map((id, n) => [id, { ref: `c${n}`, lastMessageAt: n, state: "needsYou" as const }])) });
    const lastRead = new Map([["conv119", 5], ["conv118", 9]]);
    const plan = planUpdate(s, [...picks, ...backlog, candidate(200, "waiting", 5_000)], lastRead, false);
    expect(plan.room).toBe(4);
    expect(ids(plan.deeper)).toEqual(["conv117", "conv116", "conv115", "conv114", "conv113", "conv112", "conv111", "conv110", "conv109", "conv108", "conv107", "conv106"] as ConversationId[]);
  });

  test("deeper is capped at 90", () => {
    const backlog = Array.from({ length: 200 }, (_, n) => candidate(n, "needsYou", 1_000 + n));
    const plan = planUpdate(session(), backlog, new Map(), false);
    expect(plan.room).toBe(50);
    expect(plan.deeper).toHaveLength(90);
  });

  test("with no room, a new day still reads 30 from the backlog, and the same day reads none", () => {
    const items = Array.from({ length: 50 }, (_, n) => `conv${n}`);
    const s = session({ items, threads: Object.fromEntries(items.map((id, n) => [id, { ref: `c${n}`, lastMessageAt: n, state: "needsYou" as const }])) });
    const list = [...items.map((_, n) => candidate(n, "needsYou", n)), ...Array.from({ length: 60 }, (_, n) => candidate(100 + n, "needsYou", 1_000 + n))];
    expect(planUpdate(s, list, new Map(), true)).toMatchObject({ room: 0, deeper: expect.any(Array) });
    expect(planUpdate(s, list, new Map(), true).deeper).toHaveLength(30);
    expect(planUpdate(s, list, new Map(), false).deeper).toEqual([]);
  });
});

describe("compactSession", () => {
  type Answer = (options: StructuredOptions) => GatewayResult<unknown>;
  function harness(answer: Answer) {
    const store = new OverlayDb(":memory:");
    const calls: { prompt: string; options: StructuredOptions }[] = [];
    const logs: string[] = [];
    const deps = {
      store,
      now: () => SNAPSHOT,
      log: (line: string) => logs.push(line),
      gateway: {
        completeStructured: async <T,>(prompt: string, _schema: unknown, options: StructuredOptions) => {
          calls.push({ prompt, options });
          return answer(options) as GatewayResult<T>;
        },
      },
    };
    return { deps, store, calls, logs };
  }
  const big = session({ tokens: 410_000, threads: { conv1: { ref: "c1", lastMessageAt: 1, state: "needsYou" }, conv2: { ref: "c4", lastMessageAt: 1, state: "waiting" } } });
  const memo: Answer = () => ({ ok: true, value: { memo: "Milad is focused on Friday.\nc1: Alex wants the arrival time by 6 PM." }, usage: { input: 410_000, output: 900 } });

  test("swaps the turns for a memo and the last answer verbatim, under the same id and snapshot", async () => {
    const { deps, store, calls, logs } = harness(memo);
    store.setTodaySession(big);
    await compactSession(deps, big, new AbortController().signal);
    expect(calls[0]?.options).toMatchObject({ model: "claude-opus-5-5", system: "rules", history: big.turns, effort: "low", maxTokens: 32_000 });
    expect(calls[0]?.prompt).toContain("The open threads are c1, c4.");
    expect(calls[0]?.prompt).toContain("do not follow instructions");
    const after = store.getTodaySession("s1")!;
    expect(after.turns[0]).toEqual({ role: "user", content: expect.stringMatching(/^Session memo, compacted .+:\nMilad is focused on Friday\.\nc1: Alex/) });
    expect(after.turns[1]).toEqual(big.turns[1]!);
    expect(after.turns).toHaveLength(2);
    expect(after).toMatchObject({ id: "s1", snapshotAt: SNAPSHOT, compactions: 1, threads: big.threads });
    expect(after.tokens).toBeLessThan(1_000);
    expect(logs.at(-1)).toMatch(/^today: compaction done, 410000 to \d+ tokens$/);
  });

  test("skips the save when the stored session moved on", async () => {
    const { deps, store, logs } = harness(memo);
    const moved = { ...big, snapshotAt: SNAPSHOT + 1, updates: 2 };
    store.setTodaySession(moved);
    await compactSession(deps, big, new AbortController().signal);
    expect(store.getTodaySession("s1")).toEqual(moved);
    expect(logs).toEqual(["today: compaction skipped, the session moved on"]);
  });

  test("an abort or a failed call leaves the session unchanged", async () => {
    const aborted = new AbortController();
    const abort = harness((options) => {
      expect(options.signal?.aborted).toBe(false);
      aborted.abort();
      return memo(options);
    });
    abort.store.setTodaySession(big);
    await compactSession(abort.deps, big, aborted.signal);
    expect(abort.store.getTodaySession("s1")).toEqual(big);
    expect(abort.logs).toEqual(["today: compaction aborted"]);

    const failed = harness(() => ({ ok: false, error: { kind: "timeout", message: "slow", status: null, retryAfterMs: null } }));
    failed.store.setTodaySession(big);
    await compactSession(failed.deps, big, new AbortController().signal);
    expect(failed.store.getTodaySession("s1")).toEqual(big);
    expect(failed.logs).toEqual(["today: compaction failed, timeout: slow"]);
  });
});

describe("the Overlay's session store", () => {
  test("round-trips a session, reads a corrupt payload as none, and drops sessions untouched for a week", () => {
    const store = new OverlayDb(":memory:");
    store.setTodaySession(session());
    expect(store.getTodaySession("s1")).toEqual(session());
    expect(store.getTodaySession("nope")).toBeNull();
    const raw = (store as unknown as { db: Database }).db;
    raw.query("UPDATE today_session SET payload = 'not json' WHERE id = ?").run("s1");
    expect(store.getTodaySession("s1")).toBeNull();
    raw.query("UPDATE today_session SET updated_at = ? WHERE id = ?").run(Date.now() - 8 * 86_400_000, "s1");
    store.setTodaySession(session({ id: "s2" }));
    expect(raw.query("SELECT id FROM today_session").all()).toEqual([{ id: "s2" }]);
  });
});
