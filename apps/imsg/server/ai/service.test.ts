import { describe, expect, test } from "bun:test";
import type { AiConfig } from "../config";
import { OverlayDb } from "../db";
import type { Message } from "../../shared/types";
import { AiService, isStale } from "./service";
import { Gateway } from "./gateway";
import { ShadowRunner } from "./shadow";

const ANCHOR = "3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

function makeConfig(): AiConfig {
  return {
    gatewayUrl: "http://127.0.0.1:8317",
    gatewayKey: "key",
    fastModel: "gpt-5.6-luna(low)",
    vaultPath: "/nonexistent-vault",
    creatorRef: "imsg-shadow",
    shadowSeat: "imsg-shadow",
    shadowCwd: "/repo",
    ccsBin: "ccs",
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    guid: "m1",
    chatGuid: "chat-1",
    text: "hey",
    dateCreated: 1000,
    dateRead: null,
    dateDelivered: null,
    isFromMe: false,
    service: "iMessage",
    sender: { address: "+15551234567", name: "Sarah" },
    attachments: [],
    special: null,
    sendEffect: null,
    reactions: [],
    replyToGuid: null,
    replyToPreview: null,
    replyToFromMe: null,
    isGroupEvent: false,
    error: 0,
    edited: false,
    retracted: false,
    ...overrides,
  };
}

/** A Gateway whose network call is replaced by a canned completion. */
function fakeGateway(reply: string): Gateway {
  const gateway = new Gateway(makeConfig());
  (gateway as unknown as { complete: unknown }).complete = async () => ({ ok: true, value: reply });
  return gateway;
}

function makeService(options: {
  messages?: Message[];
  reply?: string;
  db?: OverlayDb;
  shadowReply?: string;
}) {
  const db = options.db ?? new OverlayDb(":memory:");
  const shadow = new ShadowRunner(makeConfig(), { get: () => ANCHOR, set: () => undefined }, async () => ({
    stdout: options.shadowReply ?? "done",
    stderr: "",
    exitCode: 0,
  }));
  const service = new AiService({
    config: makeConfig(),
    db,
    gateway: fakeGateway(options.reply ?? "[]"),
    shadow,
    fetchMessages: async () => options.messages ?? [],
    searchVault: async () => [],
  });
  return { service, db };
}

describe("isStale", () => {
  test("fresh when the anchor guid still matches", () => {
    expect(isStale("m9", "m9")).toBe(false);
  });

  test("stale once a newer message arrives", () => {
    expect(isStale("m9", "m10")).toBe(true);
  });

  test("an empty chat that gains a message goes stale", () => {
    expect(isStale(null, "m1")).toBe(true);
  });
});

describe("replySuggestions", () => {
  test("generates, caps at three, and caches", async () => {
    const { service, db } = makeService({
      messages: [makeMessage({ guid: "m5" })],
      reply: '["a","b","c","d"]',
    });
    const result = await service.replySuggestions("chat-1", "Sarah", false);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.suggestions).toEqual(["a", "b", "c"]);
      expect(result.value.stale).toBe(false);
      expect(result.value.basedOnMessageGuid).toBe("m5");
    }
    expect(db.getSuggestionCache("chat-1")?.last_message_guid).toBe("m5");
  });

  test("serves cache without regenerating", async () => {
    const db = new OverlayDb(":memory:");
    db.setSuggestionCache("chat-1", "m5", '["cached"]');
    const { service } = makeService({ messages: [makeMessage({ guid: "m5" })], db, reply: '["fresh"]' });
    const result = await service.replySuggestions("chat-1", null, false);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.suggestions).toEqual(["cached"]);
  });

  test("marks the shelf stale when a newer message arrived", async () => {
    const db = new OverlayDb(":memory:");
    db.setSuggestionCache("chat-1", "m5", '["cached"]');
    const { service } = makeService({ messages: [makeMessage({ guid: "m6" })], db });
    const result = await service.replySuggestions("chat-1", null, false);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.stale).toBe(true);
  });

  test("force regenerates and refreshes the anchor", async () => {
    const db = new OverlayDb(":memory:");
    db.setSuggestionCache("chat-1", "m5", '["cached"]');
    const { service } = makeService({ messages: [makeMessage({ guid: "m6" })], db, reply: '["fresh"]' });
    const result = await service.replySuggestions("chat-1", null, true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.suggestions).toEqual(["fresh"]);
      expect(result.value.stale).toBe(false);
    }
    expect(db.getSuggestionCache("chat-1")?.last_message_guid).toBe("m6");
  });

  test("drops non-string entries the model may emit", async () => {
    const { service } = makeService({ messages: [makeMessage()], reply: '["ok", 42, null]' });
    const result = await service.replySuggestions("chat-1", null, true);
    if (result.ok) expect(result.value.suggestions).toEqual(["ok"]);
  });

  test("survives a corrupt cache payload", async () => {
    const db = new OverlayDb(":memory:");
    db.setSuggestionCache("chat-1", "m5", "not json");
    const { service } = makeService({ messages: [makeMessage({ guid: "m5" })], db });
    const result = await service.replySuggestions("chat-1", null, false);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.suggestions).toEqual([]);
  });
});

describe("shadowTurn", () => {
  test("persists both sides of the exchange", async () => {
    const { service, db } = makeService({ messages: [makeMessage()], shadowReply: "probably Sarah" });
    const result = await service.shadowTurn("chat-1", "who is this?", "Sarah");
    expect(result.ok).toBe(true);

    const rows = db.listShadowMessages("chat-1");
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
    expect(rows[0]?.text).toBe("who is this?");
    expect(rows[1]?.text).toBe("probably Sarah");
  });

  test("keeps the user's turn when the delegate fails, so it can be retried by hand", async () => {
    const db = new OverlayDb(":memory:");
    const shadow = new ShadowRunner(makeConfig(), { get: () => ANCHOR, set: () => undefined }, async () => ({
      stdout: "",
      stderr: "seat missing",
      exitCode: 1,
    }));
    const service = new AiService({
      config: makeConfig(),
      db,
      gateway: fakeGateway("[]"),
      shadow,
      fetchMessages: async () => [],
      searchVault: async () => [],
    });

    const result = await service.shadowTurn("chat-1", "hi", null);
    expect(result.ok).toBe(false);
    const rows = db.listShadowMessages("chat-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe("user");
  });
});

describe("identify", () => {
  test("returns the structured identity", async () => {
    const { service } = makeService({
      messages: [makeMessage()],
      reply: '{"name":"Sarah Chen","confidence":"medium","reasoning":"talks about AUF"}',
    });
    const result = await service.identify("chat-1", "+15551234567", null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Sarah Chen");
      expect(result.value.confidence).toBe("medium");
    }
  });
});
