import { expect, test } from "bun:test";
import type { ReplySuggestions, SuggestionFeedbackRequest } from "../../../shared/types";
import type { Bodies, Results } from "../convex-ingest";
import type { ShelfUpdate } from "../suggestions";
import { createAiHandlers, type AiCommandDeps } from "./ai";
import type { CommandContext } from "./types";

function fixture() {
  const publications: ShelfUpdate[] = [];
  const calls: unknown[][] = [];
  let publish = true;
  let stale = false;
  const ai: AiCommandDeps["ai"] = {
    replySuggestions: async (...args) => {
      calls.push(["suggestions", ...args]);
      const suggestions: ReplySuggestions = { suggestions: [], event: null, recipeVersion: 3, selectedModel: args[3], servedModel: "terra",
        fallback: args[3] === "opus", noReply: false, basedOnMessageGuid: "m1", stale, generatedAt: 2 };
      return { ok: true, value: suggestions };
    },
    identify: async (...args) => { calls.push(["identify", ...args]); return { ok: true, value: { name: "Alex", confidence: "high", reasoning: "Mini vault lookup" } }; },
    recordSuggestionFeedback: (...args) => { calls.push(["feedback", ...args]); return { ok: false, error: "suggestion attribution was abandoned" }; },
    recordReactionFeedback: (...args) => { calls.push(["reaction", ...args]); },
    clearSuggestionLearning: (...args) => { calls.push(["clear", ...args]); },
  };
  const context = {
    chatGuid: "chat", row: { conversationId: "conversation", clientKey: "client-key" }, signal: new AbortController().signal,
    commands: {
      directory: { summaries: async () => ({ ok: true, chats: [{ guid: "chat", displayName: "Alex", isGroup: false }] }) },
      bb: { getChat: async () => ({ ok: true, value: { participants: [{ address: "+15550001111" }] } }) },
    },
    writer: { deps: { names: { lookup: () => "Known Alex" }, ingest: {
      post: async <K extends keyof Bodies>(_kind: K, body: Bodies[K]): Promise<Results[K]> => {
        publications.push((body as unknown as { update: ShelfUpdate }).update);
        return publish as Results[K];
      },
    } } },
  } as unknown as CommandContext;
  const handlers = createAiHandlers({ ai, now: () => 1, refreshContacts: async () => { calls.push(["refreshContacts"]); } });
  return { handlers, context, publications, calls, setPublished: (value: boolean) => { publish = value; }, setStale: () => { stale = true; } };
}

test("runs the selected model with refresh, publishes that shelf, and preserves fallback metadata", async () => {
  const h = fixture();
  const result = await h.handlers.suggestions.execute(h.context, { kind: "suggestions", model: "opus", refresh: true });
  expect(h.calls).toEqual([["suggestions", "chat", "Alex", true, "opus"]]);
  expect(h.publications).toMatchObject([{ kind: "publish", model: "opus", conversationId: "conversation", startedAt: 1 }]);
  expect(result.suggestions).toMatchObject({ selectedModel: "opus", servedModel: "terra", fallback: true, stale: false });
  expect(h.handlers.suggestions.longRunning).toBe(true);
});

test("a stale service result is not published, and an anchor race rejected by Convex is returned stale", async () => {
  const h = fixture();
  h.setStale();
  expect((await h.handlers.suggestions.execute(h.context, { kind: "suggestions", model: "terra", refresh: false })).suggestions.stale).toBe(true);
  expect(h.publications).toEqual([]);
  const raced = fixture();
  raced.setPublished(false);
  expect((await raced.handlers.suggestions.execute(raced.context, { kind: "suggestions", model: "terra", refresh: false })).suggestions.stale).toBe(true);
});

test("identify refreshes Mini contacts and keeps the address and known-name inputs for vault inference", async () => {
  const h = fixture();
  expect(await h.handlers.identify.execute(h.context)).toEqual({ kind: "identify", contact: { name: "Alex", confidence: "high", reasoning: "Mini vault lookup" } });
  expect(h.calls).toEqual([["refreshContacts"], ["identify", "chat", "+15550001111", "Known Alex"]]);
  expect(h.handlers.identify.longRunning).toBe(true);
});

test("feedback passes the command key to local dedupe and surfaces lineage rejection", async () => {
  const h = fixture();
  const feedback: SuggestionFeedbackRequest = {
    suggestion: { id: "s1", kind: "text", strategy: "clarify", vibe: "curious", text: "what time works?", reaction: null, targetMessageGuid: null, targetMessagePreview: null, targetPartIndex: null },
    selectedModel: "opus", servedModel: "opus", recipeVersion: 3, selectedAt: 1, finalText: "unrelated",
  };
  await expect(h.handlers.suggestionFeedback.execute(h.context, { kind: "suggestionFeedback", feedback })).rejects.toThrow("suggestion attribution was abandoned");
  expect(h.calls[0]).toEqual(["feedback", "chat", feedback, "client-key"]);
  const reaction = { ...feedback, suggestion: { ...feedback.suggestion, kind: "reaction" as const, reaction: "like" as const } };
  expect(await h.handlers.suggestionFeedback.execute(h.context, { kind: "suggestionFeedback", feedback: reaction })).toEqual({ kind: "suggestionFeedback", ok: true });
  expect(h.calls[1]).toEqual(["reaction", "chat", reaction, "client-key"]);
});

test("clear is global and waits until published shelves have been invalidated", async () => {
  const h = fixture();
  h.context.chatGuid = null;
  expect(await h.handlers.clearSuggestionLearning.execute(h.context)).toEqual({ kind: "clearSuggestionLearning", ok: true });
  expect(h.calls).toEqual([["clear", "client-key"]]);
  expect(h.publications).toEqual([{ kind: "clear", clientKey: "client-key", clearedAt: 1 }]);
});
