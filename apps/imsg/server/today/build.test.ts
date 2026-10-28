import { describe, expect, test } from "bun:test";
import type { GatewayResult, StructuredOptions } from "../ai/gateway";
import { OverlayDb } from "../db";
import { buildLogLine, buildToday, selectToday, type TodayBuildDeps, type TodayRoutes } from "./build";
import type { ConversationId, TodayCandidate } from "./prompt";
import type { TodaySession } from "./session";

const DAY = 86_400_000;
const NOW = 400 * DAY;
const claim = { day: "2026-10-27", attempt: 1, startedAt: 1_000, mode: "fresh" as const, basis: null };

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

  test("a fresh build starts a session, saved only once todayFinish accepts the queue", async () => {
    const { deps, store, reduces } = fakes([candidate(1, "needsYou"), candidate(2, "waiting")], firstItem);
    const built = await buildToday(deps, claim);
    if (!built.outcome.ok) throw new Error(built.outcome.error);
    const ref = built.outcome.queue.session!;
    expect(ref).toEqual({ id: expect.any(String), startedAt: claim.startedAt, updates: 0 });
    expect(reduces[0]?.options.history, "a fresh read has no history").toBeUndefined();
    expect(store.getTodaySession(ref.id)).toBeNull();
    built.accept();
    const saved = store.getTodaySession(ref.id)!;
    expect(saved).toMatchObject({
      id: ref.id, startedAt: claim.startedAt, snapshotAt: claim.startedAt, day: claim.day, updates: 0, compactions: 0, tokens: 5_300, nextRef: 3,
      system: reduces[0]!.options.system, items: ["conv1"],
      threads: {
        conv1: { ref: "c1", lastMessageAt: NOW - DAY / 1000, state: "needsYou", anchor: "conv1-m5" },
        conv2: { ref: "c2", lastMessageAt: NOW - 2 * DAY / 1000, state: "waiting", anchor: "conv2-m5" },
      },
    });
    const answer = { brief: "Friday first.", groups: [{ id: "g", title: "Friday", context: "Tonight." }], items: [{ ref: "c1", group: "g", reason: "Clock today." }] };
    expect(saved.turns, "the raw answer, refs intact").toEqual([{ role: "user", content: reduces[0]!.prompt }, { role: "assistant", content: JSON.stringify(answer) }]);
  });

  test("accept writes nothing once the build was abandoned", async () => {
    const controller = new AbortController();
    const { deps, store } = fakes([candidate(1, "needsYou")], firstItem);
    const built = await buildToday(deps, claim, controller.signal);
    controller.abort();
    built.accept();
    expect(store.todayReadAt().size).toBe(0);
    if (!built.outcome.ok) throw new Error(built.outcome.error);
    expect(store.getTodaySession(built.outcome.queue.session!.id)).toBeNull();
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
      expect.stringMatching(/^today: build mode=fresh candidates needsYou=2 waiting=1 · read recent=1 rotated=1 waiting=1 · cards reused=0 computed=3 escalated=0 failed=0 ms=\d+ · reduce in=61000 out=2400 ms=\d+ · items=2 settle=1 deep=1$/),
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

describe("buildToday as an Update", () => {
  const SNAP = NOW - 2 * 3_600_000;
  const at = (hoursAgo: number) => NOW - hoursAgo * 3_600_000;
  const update = { ...claim, attempt: 2, startedAt: NOW, mode: "update" as const, basis: { sessionId: "s1", snapshotAt: SNAP } };
  function stored(over: Partial<TodaySession> = {}): TodaySession {
    return {
      id: "s1", startedAt: SNAP - DAY, snapshotAt: SNAP, arrivalsSince: SNAP, day: claim.day, updates: 1, system: "frozen rules",
      turns: [{ role: "user", content: "the first read" }, { role: "assistant", content: '{"brief":"b"}' }],
      tokens: 60_000, compactions: 0, nextRef: 4, items: ["conv1", "conv2", "conv3"],
      threads: {
        conv1: { ref: "c1", lastMessageAt: at(3), state: "needsYou", anchor: "conv1-old" },
        conv2: { ref: "c2", lastMessageAt: at(4), state: "needsYou", anchor: "a2" },
        conv3: { ref: "c3", lastMessageAt: at(5), state: "needsYou", anchor: "a3" },
      },
      ...over,
    };
  }
  const at1 = (n: number, state: TodayCandidate["state"], hoursAgo: number) => ({ ...candidate(n, state), lastMessageAt: at(hoursAgo) });
  // conv1 has a new message, conv2 is unchanged, conv3 was settled, conv5 is new since the snapshot, conv6 is backlog.
  const list = [at1(1, "needsYou", 1), at1(2, "needsYou", 4), at1(5, "needsYou", 0.5), at1(6, "needsYou", 240)];
  const updated = { brief: "Updated.", groups: [{ id: "g", title: "Now", context: "" }], items: ["c2", "c3", "c1", "c4"].map((ref) => ({ ref, group: "g", reason: "Still on." })) };
  const answer: Answer = (prompt) => prompt.startsWith("Compact this session")
    ? { ok: true, value: { memo: "c1: Alex wants the arrival time." }, usage: { input: 1, output: 1 } }
    : { ok: true, value: updated, usage: { input: 70_000, output: 1_200 } };
  function setup(session: TodaySession | null = stored(), reduce: Answer = answer) {
    const store = new OverlayDb(":memory:");
    if (session) store.setTodaySession(session);
    return fakes(list, reduce, { store });
  }

  test("continues the stored session: its system and turns go as history, and the prompt carries only what changed", async () => {
    const { deps, reduces, cardCalls } = setup();
    await buildToday(deps, update);
    expect(reduces).toHaveLength(1);
    expect(reduces[0]?.options).toMatchObject({ model: "claude-opus-5-5", system: "frozen rules", history: stored().turns });
    const { prompt } = reduces[0]!;
    expect([...prompt.matchAll(/<thread ref="(c\d+)"/g)].map((m) => m[1]), "known refs kept, new refs minted from nextRef").toEqual(["c4", "c1", "c5"]);
    expect(prompt).toContain("These threads are no longer open, so leave them out: c3.");
    expect(prompt).toContain("2 of your picks are still open, so there is room for 48 more.");
    expect(prompt).not.toContain("Person 2");
    expect(cardCalls).toHaveLength(3);
  });

  test("drops a gone ref from the answer, and anchors an unchanged thread to the message the session read", async () => {
    const { deps, logs } = setup();
    const { outcome } = await buildToday(deps, update);
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.queue.items.map((item) => [item.conversationId, item.anchor])).toEqual([["conv2", "a2"], ["conv1", "conv1-m5"], ["conv5", "conv5-m5"]]);
    expect(outcome.queue).toMatchObject({
      snapshotAt: NOW, readCount: 4, candidateCount: 4, openAtSnapshot: ["conv1", "conv2", "conv5", "conv6"],
      session: { id: "s1", startedAt: SNAP - DAY, updates: 2 },
    });
    expect(logs).toContain("today: dropped 1 items the parser rejected");
    expect(logs.find((line) => line.startsWith("today: build"))).toMatch(/^today: build mode=update candidates needsYou=4 waiting=0 · read fresh=2 deeper=1 gone=1 room=48 · .* tokens=71200$/);
  });

  test("accept extends the session and marks only this turn's threads read", async () => {
    const { deps, store, reduces } = setup();
    const built = await buildToday(deps, update);
    expect(store.getTodaySession("s1"), "nothing is saved before todayFinish accepts").toEqual(stored());
    built.accept();
    const saved = store.getTodaySession("s1")!;
    expect(saved.turns).toEqual([...stored().turns, { role: "user", content: reduces[0]!.prompt }, { role: "assistant", content: JSON.stringify(updated) }]);
    expect(saved).toMatchObject({ id: "s1", startedAt: SNAP - DAY, snapshotAt: NOW, day: claim.day, updates: 2, tokens: 71_200, nextRef: 6, items: ["conv2", "conv1", "conv5"] });
    expect(saved.threads).toEqual({
      conv1: { ref: "c1", lastMessageAt: at(1), state: "needsYou", anchor: "conv1-m5" },
      conv2: { ref: "c2", lastMessageAt: at(4), state: "needsYou", anchor: "a2" },
      conv5: { ref: "c4", lastMessageAt: at(0.5), state: "needsYou", anchor: "conv5-m5" },
      conv6: { ref: "c5", lastMessageAt: at(240), state: "needsYou", anchor: "conv6-m5" },
    });
    expect([...store.todayReadAt().keys()].sort()).toEqual(["conv1", "conv5", "conv6"]);
    expect(built.compact, "under the threshold, no compaction").toBeUndefined();
  });

  test("arrivals past the fresh cap are read by the next Update", async () => {
    const arrivals = Array.from({ length: 120 }, (_, n) => ({ ...candidate(100 + n, "waiting"), lastMessageAt: at(1.5) + n }));
    const store = new OverlayDb(":memory:");
    store.setTodaySession(stored());
    const unread = () => arrivals.filter((c) => !store.todayReadAt().has(c.conversationId)).length;
    (await buildToday(fakes([...list, ...arrivals], answer, { store }).deps, update)).accept();
    expect(unread()).toBeGreaterThan(0);
    const next = { ...update, attempt: 3, startedAt: NOW + 1, basis: { sessionId: "s1", snapshotAt: NOW } };
    (await buildToday(fakes([...list, ...arrivals], answer, { store }).deps, next)).accept();
    expect(unread()).toBe(0);
    expect(store.getTodaySession("s1")?.arrivalsSince, "the watermark moves once nothing is left").toBe(NOW + 1);
  });

  test("on a new day, the turn says so and the session moves to the new day", async () => {
    const { deps, store, reduces } = setup(stored({ day: "2026-10-26" }));
    (await buildToday(deps, update)).accept();
    expect(reduces[0]?.prompt).toContain("This is a new day. Build today's queue from everything you know.");
    expect(store.getTodaySession("s1")?.day).toBe(claim.day);
  });

  for (const [reason, session, basis, when] of [
    ["no basis", stored(), null, ""],
    ["no session", null, update.basis, ""],
    ["session mismatch", stored({ snapshotAt: SNAP - 1 }), update.basis, ""],
    ["session too large", stored({ tokens: 950_000 }), update.basis, ""],
    ["session too large", stored({ tokens: 899_800 }), update.basis, ", counting the rendered turn"],
  ] as const) {
    test(`falls back to a fresh build with ${reason}${when}`, async () => {
      const fresh: Answer = (prompt) => firstItem(prompt, { model: "m", maxTokens: 1, timeoutMs: 1 });
      const { deps, logs, reduces, store } = setup(session, fresh);
      const built = await buildToday(deps, { ...update, basis });
      expect(logs).toContain(`today: update fell back to fresh: ${reason}`);
      expect(reduces).toHaveLength(1);
      expect(reduces[0]?.options.history).toBeUndefined();
      if (!built.outcome.ok) throw new Error(built.outcome.error);
      expect(built.outcome.queue.session).toMatchObject({ startedAt: NOW, updates: 0 });
      expect(built.outcome.queue.session?.id).not.toBe("s1");
      built.accept();
      expect(store.getTodaySession(built.outcome.queue.session!.id)?.updates).toBe(0);
    });
  }

  test("a session past the compaction threshold comes back with a compaction that keeps the last answer", async () => {
    const big: Answer = (prompt, options) => {
      const result = answer(prompt, options);
      return result.ok && !prompt.startsWith("Compact") ? { ...result, usage: { input: 399_000, output: 1_000 } } : result;
    };
    const { deps, store } = setup(stored(), big);
    const built = await buildToday(deps, update);
    built.accept();
    const grown = store.getTodaySession("s1")!;
    expect(grown.tokens).toBe(400_000);
    await built.compact!(new AbortController().signal);
    const compacted = store.getTodaySession("s1")!;
    expect(compacted.turns).toEqual([{ role: "user", content: expect.stringMatching(/^Session memo, compacted .+:\nc1: Alex wants the arrival time\.$/) }, grown.turns.at(-1)!]);
    expect(compacted).toMatchObject({ id: "s1", snapshotAt: NOW, compactions: 1, threads: grown.threads });
  });
});

test("buildLogLine prints unknown token counts as ?", () => {
  expect(buildLogLine({
    mode: "fresh", candidates: { needsYou: 1, waiting: 0 }, read: { recent: 1, rotated: 0, waiting: 0 },
    cards: { reused: 0, computed: 1, escalated: 0, failed: 0, callMs: [] }, cardMs: 5,
    reduce: { input: null, output: null, ms: 7 }, items: 1, settle: 0, deep: 0,
  })).toContain("reduce in=? out=? ms=7");
});
