import { describe, expect, test } from "bun:test";
import type { GatewayResult, StructuredOptions } from "../ai/gateway";
import { OverlayDb } from "../db";
import type { TodayRoutes } from "./build";
import { CARD_MODEL, CARD_WINDOWS, cardKey, cardThread, emptyCardStats, parseCard, type CardDeps } from "./cards";
import type { ConversationId, TodayThread } from "./prompt";

const card = { summary: "Alex needs the arrival time.", ask: "Arrival time", due: "Friday 6 PM", stakes: "high", settle: false, needsMore: false };

describe("parseCard", () => {
  test("keeps a valid card and maps empty ask and due to null", () => {
    expect(parseCard(card)).toEqual({ ...card, stakes: "high" });
    expect(parseCard({ ...card, ask: "  ", due: "" })).toMatchObject({ ask: null, due: null });
  });

  test("drops a card without a summary, with unknown stakes, or that is not an object", () => {
    expect(parseCard({ ...card, summary: " " })).toBeNull();
    expect(parseCard({ ...card, stakes: "urgent" })).toBeNull();
    expect(parseCard({ ...card, stakes: undefined })).toBeNull();
    expect(parseCard(null)).toBeNull();
    expect(parseCard([card])).toBeNull();
  });

  test("clips the summary to 25 words and ask and due to their lengths, and reads non-booleans as false", () => {
    const parsed = parseCard({ ...card, summary: Array.from({ length: 40 }, (_, n) => `w${n}`).join(" "), ask: "a".repeat(300), due: "d".repeat(100), settle: "yes", needsMore: 1 });
    expect(parsed?.summary.split(" ")).toHaveLength(25);
    expect(parsed?.ask).toHaveLength(160);
    expect(parsed?.due).toHaveLength(60);
    expect(parsed).toMatchObject({ settle: false, needsMore: false });
  });
});

const thread = (guid = "m1", text = "what time?"): TodayThread => ({
  ref: "c1",
  candidate: { conversationId: "conv1" as ConversationId, title: "Alex", isGroup: false, state: "needsYou", lastMessageAt: 0, unreadCount: 1 },
  people: [],
  messages: [{ guid, at: 0, fromMe: false, sender: "Alex", text, attachments: [] }],
});

function harness(answers: ((options: StructuredOptions, prompt: string) => GatewayResult<unknown>)[]) {
  const calls: { options: StructuredOptions; prompt: string }[] = [];
  const contexts: number[] = [];
  const logs: string[] = [];
  const store = new OverlayDb(":memory:");
  const deps: CardDeps = {
    store,
    now: () => 0,
    log: (line) => logs.push(line),
    port: {
      post: async <K extends keyof TodayRoutes>(route: K, body: TodayRoutes[K][0]) => {
        if (route !== "agentContext") throw new Error(`unexpected ${route}`);
        const { limit } = body as TodayRoutes["agentContext"][0];
        contexts.push(limit);
        const messages = Array.from({ length: limit }, (_, n) => ({ guid: n === limit - 1 ? "m1" : `old${n}`, at: 0, fromMe: false, sender: "Alex", text: `older ${n}`, attachments: [] }));
        return { title: "Alex", participants: [], messages } as TodayRoutes[K][1];
      },
    },
    gateway: {
      completeStructured: async <T,>(prompt: string, _schema: unknown, options: StructuredOptions) => {
        calls.push({ options, prompt });
        const answer = answers[Math.min(calls.length - 1, answers.length - 1)]!;
        return answer(options, prompt) as GatewayResult<T>;
      },
    },
  };
  return { deps, calls, contexts, logs, store };
}

const ok = (value: unknown) => () => ({ ok: true as const, value });

describe("cardThread", () => {
  test("cards with Haiku 5.5 at low effort and a 60 s timeout", async () => {
    const h = harness([ok(card)]);
    const stats = emptyCardStats();
    expect(await cardThread(h.deps, thread(), stats)).toMatchObject({ summary: card.summary });
    expect(h.calls[0]?.options).toMatchObject({ model: "claude-haiku-5-5", effort: "low", timeoutMs: 60_000 });
    expect(h.calls[0]?.prompt).toContain('<thread ref="c1" state="needs_you"');
    expect(stats).toMatchObject({ computed: 1, reused: 0, escalated: 0, failed: 0 });
  });

  test("a card that needs more is read once more at 150 messages and 2,000 characters, and only once", async () => {
    const h = harness([ok({ ...card, needsMore: true })]);
    const stats = emptyCardStats();
    const result = await cardThread(h.deps, thread(), stats);
    expect(h.calls).toHaveLength(2);
    expect(h.contexts).toEqual([150]);
    expect(h.calls[1]?.prompt).toContain("older 0");
    expect(result?.needsMore).toBe(true);
    expect(stats).toMatchObject({ computed: 2, escalated: 1 });
  });

  test("a failed escalation keeps the first card", async () => {
    const h = harness([ok({ ...card, needsMore: true }), () => ({ ok: false, error: { kind: "timeout", message: "slow", status: null, retryAfterMs: null } })]);
    const stats = emptyCardStats();
    expect(await cardThread(h.deps, thread(), stats)).toMatchObject({ summary: card.summary, needsMore: true });
    expect(stats.failed).toBe(0);
  });

  test("reuses a cached card while its exact input matches, and recomputes when a message or the model changes", async () => {
    const h = harness([ok(card)]);
    const stats = emptyCardStats();
    await cardThread(h.deps, thread("m1"), stats);
    await cardThread({ ...h.deps, now: () => 9 * 86_400_000 }, thread("m1"), stats);
    expect(h.calls, "the clock moving is not a new input").toHaveLength(1);
    expect(stats).toMatchObject({ computed: 1, reused: 1 });

    await cardThread(h.deps, thread("m1", "what time? Actually, never mind"), stats);
    expect(h.calls, "an edit inside the window, newest guid unchanged").toHaveLength(2);
    await cardThread(h.deps, { ...thread("m1"), messages: [] }, stats);
    expect(h.calls, "a retraction").toHaveLength(3);

    await cardThread(h.deps, thread("m2", "and the parking?"), stats);
    expect(h.calls, "a new message").toHaveLength(4);
    await cardThread(h.deps, { ...thread("m2", "and the parking?"), ref: "c40" }, stats);
    expect(h.calls, "the read order is not an input").toHaveLength(4);

    h.store.setTodayCard({ conversation_id: "conv1", window_size: 30, input_hash: "written-by-another-model", model: "claude-haiku-4-5", payload: JSON.stringify(card) });
    await cardThread(h.deps, thread("m2", "and the parking?"), stats);
    expect(h.calls).toHaveLength(5);
    expect(h.store.getTodayCard("conv1", 30)).toMatchObject({ model: CARD_MODEL, input_hash: cardKey(thread("m2", "and the parking?"), CARD_WINDOWS.base) });
  });

  test("an escalated card is cached at its own window, so the next build reads the window again but makes no call", async () => {
    const h = harness([ok({ ...card, needsMore: true })]);
    await cardThread(h.deps, thread(), emptyCardStats());
    const stats = emptyCardStats();
    await cardThread(h.deps, thread(), stats);
    expect(h.calls).toHaveLength(2);
    expect(h.contexts).toEqual([150, 150]);
    expect(stats).toMatchObject({ reused: 2, computed: 0, escalated: 1 });
  });

  test("a failed or unusable card answers null, is logged and is not cached", async () => {
    const h = harness([() => ({ ok: false, error: { kind: "timeout", message: "slow", status: null, retryAfterMs: null } }), ok({ summary: "" })]);
    const stats = emptyCardStats();
    expect(await cardThread(h.deps, thread(), stats)).toBeNull();
    expect(await cardThread(h.deps, thread(), stats)).toBeNull();
    expect(stats.failed).toBe(2);
    expect(h.store.getTodayCard("conv1", 30)).toBeNull();
    expect(h.logs[0]).toContain("card c1 (conv1) at 30 messages failed, timeout: slow");
  });

  test("once the card budget is spent, a cached card still serves and no new call starts", async () => {
    const h = harness([ok(card)]);
    await cardThread(h.deps, thread("m1"), emptyCardStats());
    const late = { ...h.deps, budgetLeftMs: () => 0 };
    const stats = emptyCardStats();
    expect(await cardThread(late, thread("m1"), stats)).toMatchObject({ summary: card.summary });
    expect(await cardThread(late, thread("m2", "a new question"), stats)).toBeNull();
    expect(h.calls).toHaveLength(1);
    expect(stats).toMatchObject({ reused: 1, failed: 1 });
    expect(h.logs.at(-1)).toContain("skipped, the card budget is spent");
  });

  test("a budget that runs out during the wide read starts no call, and keeps the first card", async () => {
    const h = harness([ok({ ...card, needsMore: true })]);
    let left = 30_000;
    const post = h.deps.port.post;
    const deps: CardDeps = { ...h.deps, budgetLeftMs: () => left, port: { post: async (route, body) => { left = 0; return post(route, body); } } };
    expect(await cardThread(deps, thread(), emptyCardStats())).toMatchObject({ needsMore: true });
    expect(h.contexts).toEqual([150]);
    expect(h.calls).toHaveLength(1);
  });

  test("a card call never outlives the budget", async () => {
    const h = harness([ok(card)]);
    await cardThread({ ...h.deps, budgetLeftMs: () => 4_000 }, thread(), emptyCardStats());
    expect(h.calls[0]?.options.timeoutMs).toBeLessThanOrEqual(4_000);
  });

  test("a cancelled build starts no call, and a card that lands after cancellation is not cached", async () => {
    const cancelled = new AbortController();
    cancelled.abort();
    const h = harness([ok(card)]);
    expect(await cardThread({ ...h.deps, signal: cancelled.signal }, thread(), emptyCardStats())).toBeNull();
    expect(h.calls).toEqual([]);

    const controller = new AbortController();
    const late = harness([(options) => {
      expect(options.signal).toBe(controller.signal);
      controller.abort();
      return { ok: true, value: card };
    }]);
    await cardThread({ ...late.deps, signal: controller.signal }, thread(), emptyCardStats());
    expect(late.store.getTodayCard("conv1", 30)).toBeNull();
  });
});
