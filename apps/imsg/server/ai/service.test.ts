import { describe, expect, test } from "bun:test";
import type { AiConfig } from "../config";
import { OverlayDb } from "../db";
import type { BridgeMessage, SuggestionFeedbackRequest } from "../../shared/types";
import { AiService, isStale, serializeSuggestionCache, type AiThread, type ConversationId } from "./service";
import { Gateway } from "./gateway";


const CHAT_1 = "chat-1" as ConversationId;
const CHAT_2 = "chat-2" as ConversationId;

function makeConfig(): AiConfig {
  return {
    gatewayUrl: "http://127.0.0.1:8317",
    gatewayKey: "key",
    fastModel: "gpt-5.6-luna(low)",
    vaultPath: "/nonexistent-vault",
  };
}

function makeMessage(overrides: Partial<BridgeMessage> = {}): BridgeMessage {
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
type StructuredCall = { prompt: string; schema: { properties: { suggestions: { items: { properties: { reaction: { enum: string[] } } } } } } };

function fakeGateway(reply: string, structured: object = suggestionSet("what time works?"), onGenerate?: () => void, prompts: string[] = [], calls: StructuredCall[] = []): Gateway {
  const gateway = new Gateway(makeConfig());
  (gateway as unknown as { complete: unknown }).complete = async (prompt: string) => {
    prompts.push(prompt);
    return { ok: true, value: reply };
  };
  (gateway as unknown as { completeStructured: unknown }).completeStructured = async (prompt: string, schema: StructuredCall["schema"]) => {
    calls.push({ prompt, schema });
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
  messages?: BridgeMessage[];
  reply?: string;
  structured?: object;
  db?: OverlayDb;
  fetchError?: string;
  contactEmails?: (address: string) => string[];
  onGenerate?: () => void;
  participants?: AiThread["participants"];
  route?: AiThread["route"];
  privateApi?: boolean;
  sent?: string[];
}) {
  const db = options.db ?? new OverlayDb(":memory:");
  const prompts: string[] = [];
  const calls: StructuredCall[] = [];
  const sentFor: AiThread["route"][] = [];
  const service = new AiService({
    config: makeConfig(),
    db,
    gateway: fakeGateway(options.reply ?? "[]", options.structured, options.onGenerate, prompts, calls),
    fetchThread: async () => options.fetchError
      ? { ok: false, error: options.fetchError }
      : { ok: true, value: {
        title: "Sarah", isGroup: false, participants: options.participants ?? [{ address: "+15551234567", name: "Sarah" }],
        route: options.route ?? { platform: "imessage", chatGuid: "iMessage;-;+15551234567" }, messages: options.messages ?? [],
      } },
    sentText: async (route) => {
      sentFor.push(route);
      return options.sent ?? [];
    },
    bridgeSupport: () => ({ privateApi: options.privateApi ?? true }),
    contactEmails: options.contactEmails ?? (() => []),
    searchVault: async () => [],
  });
  return { service, db, prompts, calls, sentFor };
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
  test("offers the reactions the thread's route can send, and none over SMS or without the Private API", async () => {
    const enumFor = async (overrides: Parameters<typeof makeService>[0]) => {
      const { service, calls } = makeService({ messages: [makeMessage({ guid: "m5", text: "when works?" })], ...overrides });
      await service.replySuggestions(CHAT_1, true, "opus");
      return { reactions: calls[0]!.schema.properties.suggestions.items.properties.reaction.enum, prompt: calls[0]!.prompt };
    };
    const imessage = await enumFor({});
    expect(imessage.reactions).toEqual(["none", "love", "like", "dislike", "laugh", "emphasize", "question"]);
    expect(imessage.prompt).toContain("including a reaction when natural");
    const sms = await enumFor({ route: { platform: "imessage", chatGuid: "SMS;-;+15551234567" } });
    expect(sms.reactions).toEqual(["none"]);
    expect(sms.prompt).not.toContain("including a reaction");
    expect((await enumFor({ privateApi: false })).reactions).toEqual(["none"]);
  });

  test("derives the voice from the thread's account's sent messages", async () => {
    const route = { platform: "imessage" as const, chatGuid: "iMessage;-;+15551234567" };
    const { service, calls, sentFor } = makeService({
      messages: [makeMessage({ guid: "m5", text: "when works?" })], route, sent: ["on it", "sounds right", "will do"],
    });
    await service.replySuggestions(CHAT_1, true, "opus");
    expect(sentFor).toEqual([route]);
    expect(calls[0]!.prompt).toContain("Derived profile of Milad's sent messages on this platform:\nTypical sent message length is about 7 characters.");
  });

  test("generates a structured shelf and caches it by selected model", async () => {
    const { service, db } = makeService({
      messages: [makeMessage({ guid: "m5", text: "when works?" })],
      structured: suggestionSet("what time works?"),
    });
    const result = await service.replySuggestions(CHAT_1, false, "opus");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.suggestions[0]?.text).toBe("what time works?");
      expect(result.value.selectedModel).toBe("opus");
      expect(result.value.basedOnMessageGuid).toBe("m5");
    }
    expect(db.getSuggestionCache("chat-1", "opus")?.anchor_guid).toBe("m5");
  });

  test("both routes outlast the slowest production call measured on real threads (10.3s)", async () => {
    const timeouts: Record<string, number> = {};
    for (const model of ["opus", "terra"] as const) {
      const { service } = makeService({ messages: [makeMessage({ guid: `m-${model}`, text: "when works?" })] });
      const gateway = (service as unknown as { deps: { gateway: Gateway } }).deps.gateway;
      (gateway as unknown as { completeStructured: unknown }).completeStructured = async (_prompt: string, _schema: object, options: { timeoutMs: number }) => {
        timeouts[model] = options.timeoutMs;
        return { ok: true, value: suggestionSet("what time works?") };
      };
      expect((await service.replySuggestions(CHAT_1, true, model)).ok).toBe(true);
    }
    expect(timeouts.opus).toBeGreaterThan(10_317);
    expect(timeouts.terra).toBeGreaterThan(10_317);
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
      service.replySuggestions(CHAT_1, true, "opus"),
      service.replySuggestions(CHAT_1, true, "opus"),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(calls).toBe(1);
  });

  test("regenerates route-specific cache when the anchor changes", async () => {
    const db = new OverlayDb(":memory:");
    db.setSuggestionCache({
      conversation_id: "chat-1",
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
    const result = await service.replySuggestions(CHAT_1, false, "opus");
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
    const result = await service.replySuggestions(CHAT_1, true, "terra");
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
    const result = await service.replySuggestions(CHAT_1, true, "terra");
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
    const result = await service.replySuggestions(CHAT_1, true, "opus");
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
    const result = await service.replySuggestions(CHAT_1, false, "opus");
    expect(result).toEqual({ ok: false, error: "bluebubbles unavailable" });
    expect(db.getSuggestionCache("chat-1", "opus")).toBeNull();
  });

  test("returns no reply without calling a model when Milad sent last", async () => {
    const { service } = makeService({ messages: [makeMessage({ guid: "m5", isFromMe: true })] });
    const result = await service.replySuggestions(CHAT_1, false, "terra");
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
    const result = await service.replySuggestions(CHAT_1, true, "opus");
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
    const result = await service.replySuggestions(CHAT_1, true, "opus");
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
    const result = await service.identify(CHAT_1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Sarah Chen");
      expect(result.value.confidence).toBe("medium");
    }
  });

  test("asks about the conversation's first participant under the name Convex knows", async () => {
    const { service, prompts } = makeService({
      messages: [makeMessage()],
      participants: [{ address: "+15559876543", name: "Sam Ortiz" }, { address: "+15551234567", name: null }],
      reply: '{"name":"Sam Ortiz","confidence":"high","reasoning":"contact"}',
    });
    expect((await service.identify(CHAT_1)).ok).toBe(true);
    expect(prompts[0]).toContain("+15559876543");
    expect(prompts[0]).toContain("Sam Ortiz");
    expect(await makeService({ participants: [] }).service.identify(CHAT_1)).toEqual({ ok: false, error: "no participant address" });
  });
});

describe("Convex suggestion commands", () => {
  test("keeps separate model caches and bypasses only the selected cache on refresh", async () => {
    let generations = 0;
    const { service, db } = makeService({ messages: [makeMessage({ text: "when works?" })], onGenerate: () => { generations++; } });
    await service.replySuggestions(CHAT_1, false, "opus");
    await service.replySuggestions(CHAT_1, false, "terra");
    expect(generations).toBe(2);
    expect(db.getSuggestionCache("chat-1", "opus")).not.toBeNull();
    const terra = db.getSuggestionCache("chat-1", "terra");
    expect(terra).not.toBeNull();
    await service.replySuggestions(CHAT_1, false, "opus");
    expect(generations).toBe(2);
    await service.replySuggestions(CHAT_1, true, "opus");
    expect(generations).toBe(3);
    expect(db.getSuggestionCache("chat-1", "terra")).toEqual(terra);
  });

  test("returns stale and skips caching when the anchor changes during generation", async () => {
    const messages = [makeMessage({ text: "when works?" })];
    const { service, db } = makeService({ messages, onGenerate: () => { messages.push(makeMessage({ guid: "m2", text: "actually never mind" })); } });
    const result = await service.replySuggestions(CHAT_1, false, "opus");
    expect(result).toMatchObject({ ok: true, value: { stale: true, basedOnMessageGuid: "m1" } });
    expect(db.getSuggestionCache("chat-1", "opus")).toBeNull();
  });

  test("a clear fences in-flight generation and clears learning across chats and models", async () => {
    let clear = () => {};
    const { service, db } = makeService({ messages: [makeMessage({ text: "when works?" })], onGenerate: () => clear() });
    await service.replySuggestions(CHAT_1, false, "terra");
    await service.replySuggestions(CHAT_2, false, "opus");
    service.recordSuggestionFeedback(CHAT_1, feedback(), "feedback-1");
    clear = () => service.clearSuggestionLearning("clear-1");
    const result = await service.replySuggestions(CHAT_1, true, "opus");
    expect(result).toMatchObject({ ok: true, value: { stale: true } });
    expect(db.getSuggestionCache("chat-1", "opus")).toBeNull();
    expect(db.getSuggestionCache("chat-1", "terra")).toBeNull();
    expect(db.getSuggestionCache("chat-2", "opus")).toBeNull();
    expect(db.listSuggestionFeedback()).toEqual([]);
    service.recordSuggestionFeedback(CHAT_1, feedback(), "feedback-2");
    service.clearSuggestionLearning("clear-1");
    expect(db.listSuggestionFeedback()).toHaveLength(1);
  });

  test("rejects abandoned lineage and deduplicates text and reaction feedback after restart", () => {
    const { service, db } = makeService({ messages: [] });
    expect(service.recordSuggestionFeedback(CHAT_1, { ...feedback(), finalText: "pizza delivery arrived" }, "abandoned")).toEqual({ ok: false, error: "suggestion attribution was abandoned" });
    expect(db.listSuggestionFeedback()).toEqual([]);
    expect(service.recordSuggestionFeedback(CHAT_1, feedback(), "feedback-1").ok).toBe(true);
    const restarted = makeService({ db, messages: [] }).service;
    expect(restarted.recordSuggestionFeedback(CHAT_1, feedback(), "feedback-1").ok).toBe(true);
    const reaction = { ...feedback(), suggestion: { ...feedback().suggestion, kind: "reaction" as const, reaction: "like" as const } };
    restarted.recordReactionFeedback(CHAT_1, reaction, "reaction-1");
    restarted.recordReactionFeedback(CHAT_1, reaction, "reaction-1");
    expect(db.listSuggestionFeedback()).toHaveLength(2);
  });
});

function feedback(): SuggestionFeedbackRequest {
  return {
    suggestion: { id: "s1", kind: "text", strategy: "clarify", vibe: "curious", text: "what time works?", reaction: null, targetMessageGuid: null, targetMessagePreview: null, targetPartIndex: null },
    selectedModel: "opus", servedModel: "opus", recipeVersion: 1, selectedAt: 1, finalText: "what time works for you?",
  };
}
