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

/** A Gateway whose network calls are replaced by canned completions. */
function fakeGateway(reply: string, structured: object = suggestionSet("what time works?")): Gateway {
  const gateway = new Gateway(makeConfig());
  (gateway as unknown as { complete: unknown }).complete = async () => ({ ok: true, value: reply });
  (gateway as unknown as { completeStructured: unknown }).completeStructured = async () => ({ ok: true, value: structured });
  return gateway;
}

function suggestionSet(text: string, overrides: Record<string, object | string | boolean | number | string[]> = {}): object {
  return {
    noReply: false,
    suggestions: [{
      kind: "text",
      strategy: "clarify",
      vibe: "curious",
      text,
      reaction: "none",
      targetMessageGuid: "",
      targetPartIndex: 0,
      basisMessageGuids: [],
      decisionOption: false,
      introducesCommitment: false,
      ...overrides,
    }],
  };
}

function makeService(options: {
  messages?: Message[];
  reply?: string;
  structured?: object;
  db?: OverlayDb;
  shadowReply?: string;
  fetchError?: string;
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
    gateway: fakeGateway(options.reply ?? "[]", options.structured),
    shadow,
    fetchMessages: async () => options.fetchError
      ? { ok: false, error: options.fetchError }
      : { ok: true, value: options.messages ?? [] },
    fetchMessageWithReactions: async (_chatGuid, messageGuid) => {
      const message = options.messages?.find((item) => item.guid === messageGuid);
      return message ? { ok: true, value: message } : { ok: false, error: "not found" };
    },
    recentOutboundText: () => [],
    reactionSuggestions: () => true,
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
  test("generates a structured shelf and caches it by selected model", async () => {
    const { service, db } = makeService({
      messages: [makeMessage({ guid: "m5", text: "when works?" })],
      structured: suggestionSet("what time works?"),
    });
    const result = await service.replySuggestions("chat-1", "Sarah", false, "opus");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.suggestions[0]?.text).toBe("what time works?");
      expect(result.value.selectedModel).toBe("opus");
      expect(result.value.basedOnMessageGuid).toBe("m5");
    }
    expect(db.getSuggestionCache("chat-1", "opus")?.anchor_guid).toBe("m5");
  });

  test("deduplicates concurrent generation by full route identity", async () => {
    const { service } = makeService({ messages: [makeMessage({ guid: "m5", text: "when works?" })] });
    let calls = 0;
    const gateway = (service as unknown as { deps: { gateway: Gateway } }).deps.gateway;
    (gateway as unknown as { completeStructured: unknown }).completeStructured = async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { ok: true, value: suggestionSet("what time works?") };
    };
    const [first, second] = await Promise.all([
      service.replySuggestions("chat-1", null, true, "opus"),
      service.replySuggestions("chat-1", null, true, "opus"),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(calls).toBe(1);
  });

  test("regenerates route-specific cache when the anchor changes", async () => {
    const db = new OverlayDb(":memory:");
    db.setSuggestionCache({
      chat_guid: "chat-1",
      selected_model: "opus",
      anchor_guid: "m5",
      recipe_version: 3,
      voice_revision: 2166136261,
      edit_revision: 1947613349,
      payload: serializeSuggestionCache({
        recipeVersion: 3,
        selectedModel: "opus",
        servedModel: "opus",
        fallback: false,
        noReply: false,
        suggestions: [],
      }),
    });
    const { service } = makeService({ messages: [makeMessage({ guid: "m6" })], db });
    const result = await service.replySuggestions("chat-1", null, false, "opus");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stale).toBe(false);
      expect(result.value.basedOnMessageGuid).toBe("m6");
    }
  });

  test("propagates message-read failures instead of caching silence", async () => {
    const { service, db } = makeService({ fetchError: "bluebubbles unavailable" });
    const result = await service.replySuggestions("chat-1", null, false, "opus");
    expect(result).toEqual({ ok: false, error: "bluebubbles unavailable" });
    expect(db.getSuggestionCache("chat-1", "opus")).toBeNull();
  });

  test("returns no reply without calling a model when Milad sent last", async () => {
    const { service } = makeService({ messages: [makeMessage({ guid: "m5", isFromMe: true })] });
    const result = await service.replySuggestions("chat-1", null, false, "terra");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.noReply).toBe(true);
      expect(result.value.suggestions).toEqual([]);
    }
  });

  test("falls back to Terra on an Opus provider failure", async () => {
    const { service } = makeService({ messages: [makeMessage({ text: "when works?" })] });
    const gateway = (service as unknown as { deps: { gateway: Gateway } }).deps.gateway;
    let calls = 0;
    (gateway as unknown as { completeStructured: unknown }).completeStructured = async () => {
      calls++;
      return calls === 1
        ? { ok: false, error: { kind: "provider", message: "quota", status: 429, retryAfterMs: 60_000 } }
        : { ok: true, value: suggestionSet("what time works?") };
    };
    const result = await service.replySuggestions("chat-1", null, true, "opus");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.servedModel).toBe("terra");
      expect(result.value.fallback).toBe(true);
    }
    expect(calls).toBe(2);
  });

  test("does not retry a shared gateway failure", async () => {
    const { service } = makeService({ messages: [makeMessage({ text: "when works?" })] });
    const gateway = (service as unknown as { deps: { gateway: Gateway } }).deps.gateway;
    let calls = 0;
    (gateway as unknown as { completeStructured: unknown }).completeStructured = async () => {
      calls++;
      return { ok: false, error: { kind: "shared", message: "gateway down", status: 503, retryAfterMs: null } };
    };
    const result = await service.replySuggestions("chat-1", null, true, "opus");
    expect(result).toEqual({ ok: false, error: "gateway down" });
    expect(calls).toBe(1);
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
      fetchMessages: async () => ({ ok: true, value: [] }),
      fetchMessageWithReactions: async () => ({ ok: false, error: "not found" }),
      recentOutboundText: () => [],
      reactionSuggestions: () => false,
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
      fetchMessages: async () => ({ ok: true, value: [] }),
      fetchMessageWithReactions: async () => ({ ok: false, error: "not found" }),
      recentOutboundText: () => [],
      reactionSuggestions: () => false,
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
