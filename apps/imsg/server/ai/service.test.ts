import { describe, expect, test } from "bun:test";
import type { AiConfig } from "../config";
import { OverlayDb } from "../db";
import type { Message } from "../../shared/types";
import { AiService, isStale, serializeSuggestionCache } from "./service";
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
  test("generates through the harness lane, caps at three, and caches", async () => {
    const { service, db } = makeService({
      messages: [makeMessage({ guid: "m5" })],
      shadowReply: 'Two variations:\n```json\n["a","b","c","d"]\n```',
    });
    const result = await service.replySuggestions("chat-1", "Sarah", false);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.suggestions).toEqual(["a", "b"]);
      expect(result.value.stale).toBe(false);
      expect(result.value.basedOnMessageGuid).toBe("m5");
    }
    expect(db.getSuggestionCache("chat-1")?.last_message_guid).toBe("m5");
  });

  test("deduplicates concurrent generation for the same chat and message", async () => {
    const { service } = makeService({ messages: [makeMessage({ guid: "m5" })] });
    let calls = 0;
    (service as unknown as { deps: { shadow: { turn: (prompt: string) => Promise<{ ok: true; value: string }> } } }).deps.shadow.turn = async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { ok: true, value: '["fresh"]' };
    };
    const [first, second] = await Promise.all([
      service.replySuggestions("chat-1", null, true),
      service.replySuggestions("chat-1", null, true),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(calls).toBe(1);
  });

  test("limits concurrent harness suggestion generation", async () => {
    const { service } = makeService({ messages: [makeMessage({ guid: "m5" })] });
    let active = 0;
    let peak = 0;
    (service as unknown as { deps: { shadow: { turn: (prompt: string) => Promise<{ ok: true; value: string }> } } }).deps.shadow.turn = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return { ok: true, value: '["fresh"]' };
    };
    await Promise.all([
      service.replySuggestions("chat-1", null, true),
      service.replySuggestions("chat-2", null, true),
      service.replySuggestions("chat-3", null, true),
      service.replySuggestions("chat-4", null, true),
    ]);
    expect(peak).toBe(2);
  });

  test("accepts a bare JSON array with narration around it", async () => {
    const { service } = makeService({
      messages: [makeMessage({ guid: "m5" })],
      shadowReply: 'The thread is light. ["one","two"] — pick any.',
    });
    const result = await service.replySuggestions("chat-1", null, false);
    if (result.ok) expect(result.value.suggestions).toEqual(["one", "two"]);
  });

  test("serves cache without regenerating", async () => {
    const db = new OverlayDb(":memory:");
    db.setSuggestionCache("chat-1", "m5", serializeSuggestionCache(["cached"]));
    const { service } = makeService({
      messages: [makeMessage({ guid: "m5" })],
      db,
      shadowReply: '["fresh"]',
    });
    const result = await service.replySuggestions("chat-1", null, false);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.suggestions).toEqual(["cached"]);
  });

  test("marks the shelf stale when a newer message arrived", async () => {
    const db = new OverlayDb(":memory:");
    db.setSuggestionCache("chat-1", "m5", serializeSuggestionCache(["cached"]));
    const { service } = makeService({ messages: [makeMessage({ guid: "m6" })], db });
    const result = await service.replySuggestions("chat-1", null, false);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.stale).toBe(true);
  });

  test("force regenerates and refreshes the anchor", async () => {
    const db = new OverlayDb(":memory:");
    db.setSuggestionCache("chat-1", "m5", serializeSuggestionCache(["cached"]));
    const { service } = makeService({
      messages: [makeMessage({ guid: "m6" })],
      db,
      shadowReply: '["fresh"]',
    });
    const result = await service.replySuggestions("chat-1", null, true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.suggestions).toEqual(["fresh"]);
      expect(result.value.stale).toBe(false);
    }
    expect(db.getSuggestionCache("chat-1")?.last_message_guid).toBe("m6");
  });

  test("drops non-string entries the model may emit", async () => {
    const { service } = makeService({
      messages: [makeMessage()],
      shadowReply: '["ok", 42, null]',
    });
    const result = await service.replySuggestions("chat-1", null, true);
    if (result.ok) expect(result.value.suggestions).toEqual(["ok"]);
  });

  test("fails cleanly when the harness reply contains no array", async () => {
    const { service } = makeService({
      messages: [makeMessage()],
      shadowReply: "I thought about it and here is what I would say…",
    });
    const result = await service.replySuggestions("chat-1", null, true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("no suggestion array");
  });

  test("regenerates a corrupt cache payload", async () => {
    const db = new OverlayDb(":memory:");
    db.setSuggestionCache("chat-1", "m5", "not json");
    const { service } = makeService({
      messages: [makeMessage({ guid: "m5" })],
      db,
      shadowReply: '["fresh one", "fresh two"]',
    });
    const result = await service.replySuggestions("chat-1", null, false);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.suggestions).toEqual(["fresh one", "fresh two"]);
  });

  test("regenerates legacy array caches after the prompt contract changes", async () => {
    const db = new OverlayDb(":memory:");
    db.setSuggestionCache("chat-1", "m5", '["obsolete"]');
    const { service } = makeService({
      messages: [makeMessage({ guid: "m5" })],
      db,
      shadowReply: '["current one", "current two"]',
    });
    const result = await service.replySuggestions("chat-1", null, false);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.suggestions).toEqual(["current one", "current two"]);
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

describe("smartCloser", () => {
  test("validates, caches by latest inbound, and serves the cache", async () => {
    const { service, db } = makeService({
      messages: [makeMessage({ guid: "in-9", text: "can you call me?" })],
      reply: '{"kind":"call","label":"Call"}',
    });
    const first = await service.smartCloser("chat-1");
    const second = await service.smartCloser("chat-1");
    expect(first).toEqual({ ok: true, value: { kind: "call", label: "Call" } });
    expect(second).toEqual(first);
    expect(db.getSmartCloserCache("chat-1")?.inbound_message_guid).toBe("in-9");
  });

  test("falls back deterministically when model output fails strict parsing", async () => {
    const { service } = makeService({
      messages: [makeMessage({ text: "thanks" })],
      reply: '{"kind":"send","label":"Send","draft":"bad"}',
    });
    expect(await service.smartCloser("chat-1")).toEqual({
      ok: true,
      value: { kind: "done", label: "Done" },
    });
  });
});

describe("shadowBrief", () => {
  test("strictly parses and caches a brief by last message GUID", async () => {
    const { service, db } = makeService({
      messages: [makeMessage({ guid: "m12" })],
      reply: '{"context":"Sarah needs the venue","actionItems":["send venue"],"draft":"sending now"}',
    });
    const result = await service.shadowBrief("chat-1", false);
    expect(result).toEqual({
      ok: true,
      value: {
        context: "Sarah needs the venue",
        actionItems: ["send venue"],
        draft: "sending now",
        basedOnMessageGuid: "m12",
      },
    });
    expect(db.getShadowBriefCache("chat-1")?.message_guid).toBe("m12");
  });

  test("uses a safe empty brief for malformed generated data", async () => {
    const { service } = makeService({
      messages: [makeMessage()],
      reply: '{"context":"x","actionItems":"not-an-array","draft":"send"}',
    });
    const result = await service.shadowBrief("chat-1", true);
    expect(result).toEqual({
      ok: true,
      value: { context: "", actionItems: [], draft: "", basedOnMessageGuid: "m1" },
    });
  });
});
