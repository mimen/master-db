import { expect, test } from "bun:test";
import { OverlayDb } from "../db";
import type { ChatSummary, ReplySuggestions } from "../../shared/types";
import { FakeIngest } from "./fake-ingest";
import type { MessageRow } from "./convex-ingest";
import { SUGGESTION_PRECOMPUTE, SuggestionsBridge } from "./suggestions";

const CHAT = "iMessage;-;+15550001111";

function message(guid: string, overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    guid, conversationId: "conversation-test", chatGuid: CHAT, dateCreated: 1000, isFromMe: false, text: "hey?",
    service: "iMessage", error: 0, edited: false, retracted: false, isTapback: false, reactions: [],
    isGroupEvent: false, mentions: [], attachmentGuids: [], sourceVersion: 1, ...overrides,
  } as MessageRow;
}

function chat(lastGuid: string, overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    guid: CHAT, displayName: "Alex", isGroup: false, participants: [{ address: "+15550001111", name: "Alex" }],
    lastMessage: { guid: lastGuid, text: "hey?", dateCreated: 1000, isFromMe: false, senderName: "Alex", hasAttachments: false },
    isSpam: false, ...overrides,
  } as ChatSummary;
}

function result(anchor: string): ReplySuggestions {
  return {
    suggestions: [], event: null, recipeVersion: 1, selectedModel: "opus", servedModel: "opus",
    fallback: false, noReply: false, basedOnMessageGuid: anchor, stale: false, generatedAt: 1,
  };
}

function harness(current: ChatSummary | null) {
  const db = new OverlayDb(":memory:");
  const ingest = new FakeIngest();
  let generations = 0;
  let now = 10_000;
  const bridge = new SuggestionsBridge({
    db, ingest,
    ai: {
      available: true,
      replySuggestions: (_chat, _peer, _refresh, _model) => {
        generations++;
        return Promise.resolve({ ok: true as const, value: result(current?.lastMessage?.guid ?? "") });
      },
    },
    getChat: () => Promise.resolve(current),
    now: () => now,
  });
  return {
    bridge, ingest, db,
    advance: (ms: number) => { now += ms; },
    generations: () => generations,
    posted: () => ingest.calls.filter((call) => call.kind === "suggestions").map((call) => call.body),
  };
}

test("an inbound DM from a known contact precomputes once after the debounce", async () => {
  const h = harness(chat("m1"));
  h.bridge.observe([message("m1")]);
  await h.bridge.flush();
  expect(h.generations()).toBe(0);
  h.advance(SUGGESTION_PRECOMPUTE.debounceMs);
  await h.bridge.flush();
  expect(h.generations()).toBe(1);
  expect(h.posted()).toEqual([expect.objectContaining({ conversationId: "conversation-test", anchorGuid: "m1" })]);
  h.bridge.stop();
});

test("groups, unknown senders, and chats I replied to are skipped", async () => {
  for (const current of [
    chat("m1", { isGroup: true }),
    chat("m1", { participants: [{ address: "+15550001111", name: null }] }),
    chat("m1", { lastMessage: { guid: "m1", text: "ok", dateCreated: 1000, isFromMe: true, senderName: null, hasAttachments: false } }),
  ]) {
    const h = harness(current);
    h.bridge.observe([message("m1")]);
    h.advance(SUGGESTION_PRECOMPUTE.debounceMs);
    await h.bridge.flush();
    expect(h.generations()).toBe(0);
    h.bridge.stop();
  }
});

test("my own reply cancels a pending precompute", async () => {
  const h = harness(chat("m1"));
  h.bridge.observe([message("m1"), message("m2", { isFromMe: true, dateCreated: 2000 })]);
  h.advance(SUGGESTION_PRECOMPUTE.debounceMs);
  await h.bridge.flush();
  expect(h.generations()).toBe(0);
  h.bridge.stop();
});

test("the daily cap stops generation and survives a restart", async () => {
  const h = harness(chat("m1"));
  h.db.setAiMeta("suggestion_precompute_budget", JSON.stringify({
    day: new Date(10_000).toISOString().slice(0, 10), generatedToday: SUGGESTION_PRECOMPUTE.dailyCap, lastAt: 1,
  }));
  const capped = new SuggestionsBridge({
    db: h.db, ingest: h.ingest,
    ai: { available: true, replySuggestions: () => { throw new Error("should not generate"); } },
    getChat: () => Promise.resolve(chat("m1")),
    now: () => 20_000,
  });
  capped.observe([message("m1")]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await capped.flush();
  expect(capped.health()).toMatchObject({ generatedToday: SUGGESTION_PRECOMPUTE.dailyCap, cap: SUGGESTION_PRECOMPUTE.dailyCap });
  expect(h.ingest.calls.filter((call) => call.kind === "suggestions")).toEqual([]);
  capped.stop();
  h.bridge.stop();
});
