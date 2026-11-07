import { expect, test } from "bun:test";
import { OverlayDb } from "../db";
import type { ReplySuggestions } from "../../shared/types";
import { FakeIngest } from "./fake-ingest";
import type { MessageRow } from "./convex-ingest";
import type { MappedChat } from "../map";
import { SUGGESTION_PRECOMPUTE, SuggestionsBridge, type ShelfUpdate } from "./suggestions";

const CHAT = "iMessage;-;+15550001111";

function message(guid: string, overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    guid, conversationId: "conversation-test", chatGuid: CHAT, dateCreated: 1000, isFromMe: false, text: "hey?",
    service: "iMessage", error: 0, edited: false, retracted: false, isTapback: false, reactions: [],
    isGroupEvent: false, mentions: [], attachmentGuids: [], sourceVersion: 1, ...overrides,
  } as MessageRow;
}

function chat(overrides: Partial<MappedChat> = {}): MappedChat {
  return {
    displayName: "Alex", isGroup: false, participants: [{ address: "+15550001111", name: "Alex" }], ...overrides,
  } as MappedChat;
}

function result(anchor: string): ReplySuggestions {
  return {
    suggestions: [], event: null, recipeVersion: 1, selectedModel: "opus", servedModel: "opus",
    fallback: false, noReply: false, basedOnMessageGuid: anchor, stale: false, generatedAt: 1,
  };
}

function harness(current: MappedChat | undefined, during: (bridge: SuggestionsBridge) => void = () => {}) {
  const db = new OverlayDb(":memory:");
  const ingest = new FakeIngest();
  let generations = 0;
  let now = 10_000;
  const bridge = new SuggestionsBridge({
    db, ingest,
    ai: {
      available: true,
      replySuggestions: (_conversation, _refresh, _model) => {
        generations++;
        during(bridge);
        return Promise.resolve({ ok: true as const, value: result("m1") });
      },
    },
    conversation: () => current,
    now: () => now,
  });
  return {
    bridge, ingest, db,
    advance: (ms: number) => { now += ms; },
    generations: () => generations,
    posted: () => (ingest.calls as unknown as Array<{ kind: string; body: { update: ShelfUpdate } }>).filter((call) => call.kind === "suggestionShelves").map((call) => call.body.update),
  };
}

test("an inbound DM from a known contact precomputes once after the debounce", async () => {
  const h = harness(chat());
  h.bridge.observe([message("m1")]);
  await h.bridge.flush();
  expect(h.generations()).toBe(0);
  h.advance(SUGGESTION_PRECOMPUTE.debounceMs);
  await h.bridge.flush();
  expect(h.generations()).toBe(1);
  expect(h.posted()).toEqual([expect.objectContaining({ kind: "publish", model: "opus", conversationId: "conversation-test", suggestions: expect.objectContaining({ basedOnMessageGuid: "m1" }) })]);
  h.bridge.stop();
});

test("groups, unknown senders, spam, and unmirrored chats are skipped", async () => {
  for (const [current, spam] of [
    [chat({ isGroup: true }), false],
    [chat({ participants: [{ address: "+15550001111", name: null }] }), false],
    [chat(), true],
    [undefined, false],
  ] as const) {
    const h = harness(current);
    h.bridge.observe([message("m1", { isSpam: spam })]);
    h.advance(SUGGESTION_PRECOMPUTE.debounceMs);
    await h.bridge.flush();
    expect(h.generations()).toBe(0);
    h.bridge.stop();
  }
});

test("my own reply cancels a pending precompute", async () => {
  const h = harness(chat());
  h.bridge.observe([message("m1"), message("m2", { isFromMe: true, dateCreated: 2000 })]);
  h.advance(SUGGESTION_PRECOMPUTE.debounceMs);
  await h.bridge.flush();
  expect(h.generations()).toBe(0);
  h.bridge.stop();
});

test("a reply that lands while generating keeps the shelf unpublished", async () => {
  const h = harness(chat(), (bridge) => bridge.observe([message("m2", { isFromMe: true, dateCreated: 2000 })]));
  h.bridge.observe([message("m1")]);
  h.advance(SUGGESTION_PRECOMPUTE.debounceMs);
  await h.bridge.flush();
  expect(h.generations()).toBe(1);
  expect(h.posted()).toEqual([]);
  h.bridge.stop();
});

test("the daily cap stops generation and survives a restart", async () => {
  const h = harness(chat());
  h.db.setAiMeta("suggestion_precompute_budget", JSON.stringify({
    day: new Date(10_000).toISOString().slice(0, 10), generatedToday: SUGGESTION_PRECOMPUTE.dailyCap, lastAt: 1,
  }));
  const capped = new SuggestionsBridge({
    db: h.db, ingest: h.ingest,
    ai: { available: true, replySuggestions: () => { throw new Error("should not generate"); } },
    conversation: () => chat(),
    now: () => 20_000,
  });
  capped.observe([message("m1")]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await capped.flush();
  expect(capped.health()).toMatchObject({ generatedToday: SUGGESTION_PRECOMPUTE.dailyCap, cap: SUGGESTION_PRECOMPUTE.dailyCap });
  expect(h.posted()).toEqual([]);
  capped.stop();
  h.bridge.stop();
});
