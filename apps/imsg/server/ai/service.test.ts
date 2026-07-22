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

describe("shadowEnqueue", () => {
  test("persists the user turn synchronously and the reply when the delegate finishes", async () => {
    const { service, db } = makeService({ messages: [makeMessage()], shadowReply: "probably Sarah" });
    const done = service.shadowEnqueue("chat-1", "who is this?", "Sarah");

    // User message is persisted before the turn resolves.
    expect(db.listShadowMessages("chat-1").map((r) => r.text)).toEqual(["who is this?"]);
    expect(service.shadowPending("chat-1")).toBe(true);

    await done;
    const rows = db.listShadowMessages("chat-1");
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
    expect(rows[1]?.text).toBe("probably Sarah");
    expect(service.shadowPending("chat-1")).toBe(false);
  });

  test("persists a visible error rather than stranding the user's message", async () => {
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

    await service.shadowEnqueue("chat-1", "hi", null);
    const rows = db.listShadowMessages("chat-1");
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
    expect(rows[1]?.text).toContain("⚠️");
    expect(rows[1]?.text).toContain("seat missing");
  });

  test("serializes concurrent turns for one chat", async () => {
    const db = new OverlayDb(":memory:");
    let active = 0;
    let maxActive = 0;
    const shadow = new ShadowRunner(makeConfig(), { get: () => ANCHOR, set: () => undefined }, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return { stdout: "ok", stderr: "", exitCode: 0 };
    });
    const service = new AiService({
      config: makeConfig(),
      db,
      gateway: fakeGateway("[]"),
      shadow,
      fetchMessages: async () => [],
      searchVault: async () => [],
    });

    const a = service.shadowEnqueue("chat-1", "first", null);
    const b = service.shadowEnqueue("chat-1", "second", null);
    await Promise.all([a, b]);
    expect(maxActive).toBe(1); // never two delegates at once for the same chat
    expect(db.listShadowMessages("chat-1")).toHaveLength(4); // 2 user + 2 assistant
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
