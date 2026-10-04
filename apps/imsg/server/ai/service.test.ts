import { describe, expect, test } from "bun:test";
import type { AiConfig } from "../config";
import { OverlayDb } from "../db";
import type { Message, SuggestionFeedbackRequest } from "../../shared/types";
import { AiService, isStale, serializeSuggestionCache } from "./service";
import { Gateway } from "./gateway";


function makeConfig(): AiConfig {
  return {
    gatewayUrl: "http://127.0.0.1:8317",
    gatewayKey: "key",
    fastModel: "gpt-5.6-luna(low)",
    vaultPath: "/nonexistent-vault",
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
function fakeGateway(reply: string, structured: object = suggestionSet("what time works?"), onGenerate?: () => void): Gateway {
  const gateway = new Gateway(makeConfig());
  (gateway as unknown as { complete: unknown }).complete = async () => ({ ok: true, value: reply });
  (gateway as unknown as { completeStructured: unknown }).completeStructured = async () => {
    onGenerate?.();
    return { ok: true, value: structured };
  };
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
  fetchError?: string;
  contactEmails?: (address: string) => string[];
  onGenerate?: () => void;
}) {
  const db = options.db ?? new OverlayDb(":memory:");
  const service = new AiService({
    config: makeConfig(),
    db,
    gateway: fakeGateway(options.reply ?? "[]", options.structured, options.onGenerate),
    fetchMessages: async () => options.fetchError
      ? { ok: false, error: options.fetchError }
      : { ok: true, value: options.messages ?? [] },
    fetchMessageWithReactions: async (_chatGuid, messageGuid) => {
      const message = options.messages?.find((item) => item.guid === messageGuid);
      return message ? { ok: true, value: message } : { ok: false, error: "not found" };
    },
    recentOutboundText: async () => [],
    reactionSuggestions: () => true,
    contactEmails: options.contactEmails ?? (() => []),
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
        event: null,
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

  test("repairs a fully filtered candidate set instead of surfacing unavailable", async () => {
    const { service } = makeService({ messages: [makeMessage({ text: "would love to get on a call early this week" })] });
    const gateway = (service as unknown as { deps: { gateway: Gateway } }).deps.gateway;
    let calls = 0;
    (gateway as unknown as { completeStructured: unknown }).completeStructured = async () => {
      calls++;
      return {
        ok: true,
        value: calls === 1 ? suggestionSet("does monday work?") : suggestionSet("what day works best?"),
      };
    };
    const result = await service.replySuggestions("chat-1", null, true, "terra");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.suggestions[0]?.text).toBe("what day works best?");
    expect(calls).toBe(2);
  });

  test("returns an empty shelf when both safety-filtered attempts fail", async () => {
    const { service, db } = makeService({ messages: [makeMessage({ text: "would love to get on a call early this week" })] });
    const gateway = (service as unknown as { deps: { gateway: Gateway } }).deps.gateway;
    (gateway as unknown as { completeStructured: unknown }).completeStructured = async () => ({
      ok: true,
      value: suggestionSet("does monday work?"),
    });
    const result = await service.replySuggestions("chat-1", null, true, "terra");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.noReply).toBe(false);
      expect(result.value.suggestions).toEqual([]);
    }
    expect(db.getSuggestionCache("chat-1", "terra")).toBeNull();
  });

  test("a detected event carries the counterparty's contact email", async () => {
    // The service grounds the event against real time, so aim a week out.
    const soon = new Date(Date.now() + 7 * 24 * 60 * 60_000);
    const pad = (value: number): string => String(value).padStart(2, "0");
    const start = `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}T20:00`;
    const { service } = makeService({
      messages: [
        makeMessage({ guid: "m1", text: "8pm works any day this week" }),
        makeMessage({ guid: "m2", text: "sunday sounds good to me!" }),
      ],
      structured: {
        noReply: true,
        suggestions: [],
        event: { found: true, title: "Call with Sarah", start, durationMinutes: 60, location: "" },
      },
      contactEmails: (address) => (address === "+15551234567" ? ["sarah@example.com"] : []),
    });
    const result = await service.replySuggestions("chat-1", "Sarah", true, "opus");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.event).toEqual({
        title: "Call with Sarah",
        start,
        durationMinutes: 60,
        location: null,
        inviteEmails: ["sarah@example.com"],
      });
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

describe("Convex suggestion commands", () => {
  test("keeps separate model caches and bypasses only the selected cache on refresh", async () => {
    let generations = 0;
    const { service, db } = makeService({ messages: [makeMessage({ text: "when works?" })], onGenerate: () => { generations++; } });
    await service.replySuggestions("chat-1", "Sarah", false, "opus");
    await service.replySuggestions("chat-1", "Sarah", false, "terra");
    expect(generations).toBe(2);
    expect(db.getSuggestionCache("chat-1", "opus")).not.toBeNull();
    const terra = db.getSuggestionCache("chat-1", "terra");
    expect(terra).not.toBeNull();
    await service.replySuggestions("chat-1", "Sarah", false, "opus");
    expect(generations).toBe(2);
    await service.replySuggestions("chat-1", "Sarah", true, "opus");
    expect(generations).toBe(3);
    expect(db.getSuggestionCache("chat-1", "terra")).toEqual(terra);
  });

  test("returns stale and skips caching when the anchor changes during generation", async () => {
    const messages = [makeMessage({ text: "when works?" })];
    const { service, db } = makeService({ messages, onGenerate: () => { messages.push(makeMessage({ guid: "m2", text: "actually never mind" })); } });
    const result = await service.replySuggestions("chat-1", "Sarah", false, "opus");
    expect(result).toMatchObject({ ok: true, value: { stale: true, basedOnMessageGuid: "m1" } });
    expect(db.getSuggestionCache("chat-1", "opus")).toBeNull();
  });

  test("a clear fences in-flight generation and clears learning across chats and models", async () => {
    let clear = () => {};
    const { service, db } = makeService({ messages: [makeMessage({ text: "when works?" })], onGenerate: () => clear() });
    await service.replySuggestions("chat-1", "Sarah", false, "terra");
    await service.replySuggestions("chat-2", "Sarah", false, "opus");
    service.recordSuggestionFeedback("chat-1", feedback(), "feedback-1");
    clear = () => service.clearSuggestionLearning("clear-1");
    const result = await service.replySuggestions("chat-1", "Sarah", true, "opus");
    expect(result).toMatchObject({ ok: true, value: { stale: true } });
    expect(db.getSuggestionCache("chat-1", "opus")).toBeNull();
    expect(db.getSuggestionCache("chat-1", "terra")).toBeNull();
    expect(db.getSuggestionCache("chat-2", "opus")).toBeNull();
    expect(db.listSuggestionFeedback()).toEqual([]);
    service.recordSuggestionFeedback("chat-1", feedback(), "feedback-2");
    service.clearSuggestionLearning("clear-1");
    expect(db.listSuggestionFeedback()).toHaveLength(1);
  });

  test("rejects abandoned lineage and deduplicates text and reaction feedback after restart", () => {
    const { service, db } = makeService({ messages: [] });
    expect(service.recordSuggestionFeedback("chat-1", { ...feedback(), finalText: "pizza delivery arrived" }, "abandoned")).toEqual({ ok: false, error: "suggestion attribution was abandoned" });
    expect(db.listSuggestionFeedback()).toEqual([]);
    expect(service.recordSuggestionFeedback("chat-1", feedback(), "feedback-1").ok).toBe(true);
    const restarted = makeService({ db, messages: [] }).service;
    expect(restarted.recordSuggestionFeedback("chat-1", feedback(), "feedback-1").ok).toBe(true);
    const reaction = { ...feedback(), suggestion: { ...feedback().suggestion, kind: "reaction" as const, reaction: "like" as const } };
    restarted.recordReactionFeedback("chat-1", reaction, "reaction-1");
    restarted.recordReactionFeedback("chat-1", reaction, "reaction-1");
    expect(db.listSuggestionFeedback()).toHaveLength(2);
  });
});

function feedback(): SuggestionFeedbackRequest {
  return {
    suggestion: { id: "s1", kind: "text", strategy: "clarify", vibe: "curious", text: "what time works?", reaction: null, targetMessageGuid: null, targetMessagePreview: null, targetPartIndex: null },
    selectedModel: "opus", servedModel: "opus", recipeVersion: 1, selectedAt: 1, finalText: "what time works for you?",
  };
}
