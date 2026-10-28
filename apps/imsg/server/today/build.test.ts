import { describe, expect, test } from "bun:test";
import type { GatewayResult, StructuredOptions } from "../ai/gateway";
import { OverlayDb } from "../db";
import { buildLogLine, buildToday, selectToday, type TodayBuildDeps, type TodayRoutes } from "./build";
import type { ConversationId, TodayCandidate } from "./prompt";

const DAY = 86_400_000;
const NOW = 400 * DAY;
const claim = { day: "2026-10-27", attempt: 1, startedAt: 1_000 };

function candidate(n: number, state: TodayCandidate["state"], ageDays = n / 1000): TodayCandidate {
  return { conversationId: `conv${n}` as ConversationId, title: `Person ${n}`, isGroup: false, state, lastMessageAt: NOW - ageDays * DAY, unreadCount: 0 };
}

const card = { summary: "Wants an answer.", ask: "Answer", due: "", stakes: "medium", settle: false, needsMore: false };
type Answer = (prompt: string, options: StructuredOptions) => GatewayResult<unknown>;

function fakes(candidates: TodayCandidate[], reduce: Answer, opts: { available?: boolean; card?: Answer; store?: OverlayDb; attachments?: number } = {}) {
  const reduces: { prompt: string; options: StructuredOptions }[] = [];
  const cardCalls: string[] = [];
  const posts: string[] = [];
  const logs: string[] = [];
  const store = opts.store ?? new OverlayDb(":memory:");
  const port: TodayBuildDeps["port"] = {
    post: async <K extends keyof TodayRoutes>(route: K, body: TodayRoutes[K][0]) => {
      posts.push(route);
      if (route === "todayCandidates") {
        const { cursor } = body as TodayRoutes["todayCandidates"][0];
        const start = Number(cursor ?? 0);
        const page = candidates.slice(start, start + 100);
        return { page, continueCursor: String(start + 100), isDone: start + 100 >= candidates.length } as TodayRoutes[K][1];
      }
      if (route === "agentContext") {
        const { conversationId } = body as TodayRoutes["agentContext"][0];
        const attachments = Array.from({ length: opts.attachments ?? 0 }, (_, n) => ({ guid: `a${n}`, name: "f".repeat(120), mime: null }));
        const messages = Array.from({ length: 6 }, (_, n) => ({ guid: `${conversationId}-m${n}`, at: 0, fromMe: false, sender: "P", text: `message ${n}`, attachments }));
        return { title: "t", participants: [], messages } as TodayRoutes[K][1];
      }
      if (route === "agentPeople") return [] as TodayRoutes[K][1];
      throw new Error(`unexpected ${route}`);
    },
  };
  const deps: TodayBuildDeps = {
    port,
    store,
    gateway: {
      available: opts.available ?? true,
      completeStructured: async <T,>(prompt: string, _schema: unknown, options: StructuredOptions) => {
        if (options.model === "claude-haiku-5-5") {
          cardCalls.push(prompt);
          return (opts.card ?? (() => ({ ok: true, value: card })))(prompt, options) as GatewayResult<T>;
        }
        reduces.push({ prompt, options });
        return reduce(prompt, options) as GatewayResult<T>;
      },
    },
    profile: async () => "profile",
    now: () => NOW,
    log: (line) => logs.push(line),
  };
  return { deps, reduces, cardCalls, posts, logs, store };
}

const firstItem: Answer = (prompt) => ({
  ok: true,
  value: { brief: "Friday first.", groups: [{ id: "g", title: "Friday", context: "Tonight." }], items: [{ ref: prompt.match(/ref="(c\d+)"/)![1], group: "g", reason: "Clock today." }] },
  usage: { input: 5_000, output: 300 },
});

describe("selectToday", () => {
  test("reads the newest 100 recent Needs you, fills to 150 least recently read, and the newest 50 Waiting", () => {
    const recent = Array.from({ length: 120 }, (_, n) => candidate(n, "needsYou", 1 + n / 10));
    const old = Array.from({ length: 80 }, (_, n) => candidate(1000 + n, "needsYou", 40 + n));
    const waiting = Array.from({ length: 70 }, (_, n) => candidate(2000 + n, "waiting", n / 10));
    const lastRead = new Map([[`conv1000`, 5], [`conv1001`, 3], [`conv100`, 1]]);
    const { recent: r, rotated, waiting: w } = selectToday([...waiting, ...old, ...recent].reverse(), lastRead, NOW);
    expect(r.map((c) => c.conversationId)).toEqual(recent.slice(0, 100).map((c) => c.conversationId));
    expect(rotated).toHaveLength(50);
    // Never read first, newest first among them; then the oldest reads.
    expect(rotated[0]?.conversationId).toBe("conv101" as ConversationId);
    expect(rotated.slice(0, 19).map((c) => c.conversationId)).not.toContain("conv100");
    expect(rotated.map((c) => c.conversationId)).not.toContain("conv1000");
    expect(w.map((c) => c.conversationId)).toEqual(waiting.slice(0, 50).map((c) => c.conversationId));
  });

  test("with few recent threads, the backlog fills the rest of the 150", () => {
    const recent = Array.from({ length: 10 }, (_, n) => candidate(n, "needsYou", 2));
    const old = Array.from({ length: 200 }, (_, n) => candidate(1000 + n, "needsYou", 60 + n));
    const lastRead = new Map(old.slice(0, 100).map((c, n) => [c.conversationId as string, 10 + n]));
    const { recent: r, rotated } = selectToday([...recent, ...old], lastRead, NOW);
    expect(r).toHaveLength(10);
    expect(rotated).toHaveLength(140);
    expect(rotated.slice(0, 100).map((c) => c.conversationId)).toEqual(old.slice(100).map((c) => c.conversationId));
    expect(rotated[100]?.conversationId).toBe("conv1000" as ConversationId);
  });
});

describe("buildToday", () => {
  test("cards each read thread with Haiku, then makes exactly one Opus 5.5 reduce stamped with the claim time", async () => {
    const { deps, reduces, cardCalls } = fakes([candidate(1, "needsYou"), candidate(2, "waiting")], firstItem);
    const { outcome } = await buildToday(deps, claim);
    expect(cardCalls).toHaveLength(2);
    expect(reduces).toHaveLength(1);
    expect(reduces[0]?.options).toMatchObject({ model: "claude-opus-5-5", effort: "medium", maxTokens: 16_000, timeoutMs: 300_000 });
    expect(reduces[0]?.options.system).toContain("profile");
    expect(reduces[0]?.prompt).toContain("card: Wants an answer. · ask: Answer · stakes: medium");
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.queue).toMatchObject({ snapshotAt: 1_000, model: "claude-opus-5-5", readCount: 2, openAtSnapshot: ["conv1"] });
    expect(outcome.queue.items, "each item stores the newest message the build read").toEqual([{ conversationId: "conv1" as ConversationId, rank: 1, group: "g", reason: "Clock today.", anchor: "conv1-m5" }]);
  });

  test("openAtSnapshot keeps every Needs you past the read caps", async () => {
    const list = [
      ...Array.from({ length: 60 }, (_, n) => candidate(n, "waiting")),
      ...Array.from({ length: 170 }, (_, n) => candidate(100 + n, "needsYou", 40)),
    ];
    const { deps } = fakes(list, firstItem);
    const { outcome } = await buildToday(deps, claim);
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.queue.readCount).toBe(200);
    expect(outcome.queue.candidateCount).toBe(230);
    expect(outcome.queue.openAtSnapshot).toHaveLength(170);
  });

  test("a failed card never fails the build: that thread falls back to its last 5 raw messages", async () => {
    const { deps, reduces, logs } = fakes([candidate(1, "needsYou"), candidate(2, "needsYou")], firstItem, {
      card: (prompt) => prompt.includes('ref="c2"') ? { ok: false, error: { kind: "timeout", message: "slow", status: null, retryAfterMs: null } } : { ok: true, value: card },
    });
    const { outcome } = await buildToday(deps, claim);
    expect(outcome.ok).toBe(true);
    const [first, second] = reduces[0]!.prompt.split("\n\n");
    expect(first).toContain("card: Wants an answer.");
    expect(first).not.toContain("message 2");
    expect(first).toContain("message 3");
    expect(second).toContain("card: unavailable");
    expect(second).toContain("message 1");
    expect(second).not.toContain("message 0");
    expect(logs.some((line) => line.includes("card c2 (conv2) at 30 messages failed"))).toBe(true);
    expect(logs.at(-1)).toContain("failed=1");
  });

  test("a successful build records what it read, so the next build rotates to the rest of the backlog", async () => {
    const store = new OverlayDb(":memory:");
    const old = Array.from({ length: 200 }, (_, n) => candidate(n, "needsYou", 60 + n));
    const first = fakes(old, firstItem, { store });
    const built = await buildToday(first.deps, claim);
    expect(store.todayReadAt().size, "nothing is recorded until todayFinish accepts the queue").toBe(0);
    built.accept();
    expect(store.todayReadAt().size).toBe(150);
    expect(store.todayReadAt().get("conv0")).toBe(claim.startedAt);
    const second = fakes(old, firstItem, { store });
    (await buildToday(second.deps, { ...claim, attempt: 2, startedAt: 2_000 })).accept();
    const persons = [...second.reduces[0]!.prompt.matchAll(/^Person (\d+)$/gm)].map((match) => Number(match[1])).sort((a, b) => a - b);
    // The 50 never read come first, then the 100 newest of those read last time.
    expect(persons).toEqual([...Array.from({ length: 100 }, (_, n) => n), ...Array.from({ length: 50 }, (_, n) => 150 + n)]);
    expect(second.cardCalls).toHaveLength(50);
    expect(store.todayReadAt().get("conv150")).toBe(2_000);
  });

  test("a build abandoned mid-reduce starts nothing new and writes no reads or cards, even if accepted", async () => {
    const controller = new AbortController();
    const { deps, store, reduces } = fakes([candidate(1, "needsYou")], (_prompt, options) => {
      expect(options.signal?.aborted, "the reduce carries the build's cancellation").toBe(false);
      controller.abort(new Error("The build timed out"));
      return firstItem(_prompt, options);
    });
    const built = buildToday(deps, claim, controller.signal);
    await expect(built).rejects.toThrow("The build timed out");
    expect(reduces).toHaveLength(1);
    expect(store.todayReadAt().size).toBe(0);
  });

  test("an aborted build caches no card and makes no reduce", async () => {
    const controller = new AbortController();
    const { deps, store, reduces } = fakes([candidate(1, "needsYou")], firstItem, {
      card: () => {
        controller.abort(new Error("The build timed out"));
        return { ok: true, value: card };
      },
    });
    await expect(buildToday(deps, claim, controller.signal)).rejects.toThrow("The build timed out");
    expect(store.getTodayCard("conv1", 30)).toBeNull();
    expect(reduces).toEqual([]);
  });

  test("over the reduce cap, rotated Needs you leave first, oldest first, then Waiting, and what left is neither read nor counted", async () => {
    const list = [candidate(1, "needsYou", 1), candidate(2, "needsYou", 50), candidate(3, "needsYou", 90), candidate(4, "waiting", 2)];
    const { deps, reduces, logs, store } = fakes(list, firstItem, { attachments: 340 });
    const built = await buildToday(deps, claim);
    const persons = [...reduces[0]!.prompt.matchAll(/^Person (\d+)$/gm)].map((match) => Number(match[1]));
    expect(persons).toEqual([1, 4]);
    expect(logs).toContain("today: dropped 2 threads to fit the reduce prompt");
    expect(built.outcome).toMatchObject({ ok: true, queue: { readCount: 2 } });
    built.accept();
    expect([...store.todayReadAt().keys()].sort(), "a dropped backlog thread stays first in the rotation").toEqual(["conv1", "conv4"]);
  });

  test("a failed reduce records no reads", async () => {
    const { deps, store } = fakes([candidate(1, "needsYou")], () => ({ ok: false, error: { kind: "provider", message: "x", status: null, retryAfterMs: null } }));
    expect((await buildToday(deps, claim)).outcome).toEqual({ ok: false, error: "Opus 5.5 was unavailable" });
    expect(store.todayReadAt().size).toBe(0);
  });

  test("logs one measurement line per build", async () => {
    const list = [candidate(1, "needsYou", 45), candidate(2, "needsYou"), candidate(3, "waiting")];
    const { deps, logs } = fakes(list, (prompt) => ({
      ok: true,
      value: {
        brief: "b",
        groups: [{ id: "g", title: "Now", context: "" }, { id: "settle", title: "Just settle these", context: "" }],
        items: [
          { ref: /ref="(c\d+)"[^\n]*since="45d"/.exec(prompt)![1], group: "g", reason: "Six weeks old." },
          { ref: "c3", group: "settle", reason: "No reply needed: they said thanks" },
        ],
      },
      usage: { input: 61_000, output: 2_400 },
    }));
    await buildToday(deps, claim);
    expect(logs.filter((line) => line.startsWith("today: build"))).toEqual([
      expect.stringMatching(/^today: build candidates needsYou=2 waiting=1 · read recent=1 rotated=1 waiting=1 · cards reused=0 computed=3 escalated=0 failed=0 ms=\d+ · reduce in=61000 out=2400 ms=\d+ · items=2 settle=1 deep=1$/),
    ]);
  });

  test("maps a gateway failure to header copy", async () => {
    const { deps } = fakes([candidate(1, "needsYou")], () => ({ ok: false, error: { kind: "timeout", message: "x", status: null, retryAfterMs: null } }));
    expect((await buildToday(deps, claim)).outcome).toEqual({ ok: false, error: "The gateway timed out" });
  });

  test("fails fast without a gateway key, before reading anything", async () => {
    const { deps, posts, reduces } = fakes([candidate(1, "needsYou")], firstItem, { available: false });
    expect((await buildToday(deps, claim)).outcome).toEqual({ ok: false, error: "AI gateway not configured" });
    expect(posts).toEqual([]);
    expect(reduces).toEqual([]);
  });

  test("an empty day builds an empty queue without calling a model", async () => {
    const { deps, reduces, cardCalls } = fakes([], firstItem);
    const { outcome } = await buildToday(deps, claim);
    expect(outcome).toMatchObject({ ok: true, queue: { items: [], groups: [], readCount: 0 } });
    expect(reduces).toEqual([]);
    expect(cardCalls).toEqual([]);
  });
});

test("buildLogLine prints unknown token counts as ?", () => {
  expect(buildLogLine({
    candidates: { needsYou: 1, waiting: 0 }, read: { recent: 1, rotated: 0, waiting: 0 },
    cards: { reused: 0, computed: 1, escalated: 0, failed: 0, callMs: [] }, cardMs: 5,
    reduce: { input: null, output: null, ms: 7 }, items: 1, settle: 0, deep: 0,
  })).toContain("reduce in=? out=? ms=7");
});
