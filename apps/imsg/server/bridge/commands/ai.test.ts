import { expect, test } from "bun:test";
import type { ReplySuggestions, SuggestionFeedbackRequest, TranscriptState } from "../../../shared/types";
import type { Bodies, Results } from "../convex-ingest";
import type { ShelfUpdate } from "../suggestions";
import { createAiHandlers, type AiCommandDeps } from "./ai";
import type { postMedia } from "./media";
import type { AiContext } from "./types";

function fixture(deps: Partial<AiCommandDeps> = {}) {
  const publications: ShelfUpdate[] = [];
  const calls: unknown[][] = [];
  let publish = true;
  let stale = false;
  const ai: AiCommandDeps["ai"] = {
    replySuggestions: async (...args) => {
      calls.push(["suggestions", ...args]);
      const suggestions: ReplySuggestions = { suggestions: [], event: null, recipeVersion: 3, selectedModel: args[2], servedModel: "terra",
        fallback: args[2] === "opus", noReply: false, basedOnMessageGuid: "m1", stale, generatedAt: 2 };
      return { ok: true, value: suggestions };
    },
    identify: async (...args) => { calls.push(["identify", ...args]); return { ok: true, value: { name: "Alex", confidence: "high", reasoning: "Mini vault lookup" } }; },
    recordSuggestionFeedback: (...args) => { calls.push(["feedback", ...args]); return { ok: false, error: "suggestion attribution was abandoned" }; },
    recordReactionFeedback: (...args) => { calls.push(["reaction", ...args]); },
    clearSuggestionLearning: (...args) => { calls.push(["clear", ...args]); },
  };
  const context = {
    conversationId: "conversation", row: { conversationId: "conversation", clientKey: "client-key" }, signal: new AbortController().signal,
    withLeaseRenewal: (work: () => Promise<unknown>) => work(),
    ingest: {
      post: async <K extends keyof Bodies>(_kind: K, body: Bodies[K]): Promise<Results[K]> => {
        publications.push((body as unknown as { update: ShelfUpdate }).update);
        return publish as Results[K];
      },
    },
  } as unknown as AiContext;
  const handlers = createAiHandlers({ ai, now: () => 1, ...deps });
  return { handlers, context, publications, calls, setPublished: (value: boolean) => { publish = value; }, setStale: () => { stale = true; } };
}

test("runs the selected model with refresh on the conversation, publishes that shelf, and preserves fallback metadata", async () => {
  const h = fixture();
  const result = await h.handlers.suggestions.execute(h.context, { kind: "suggestions", model: "opus", refresh: true });
  expect(h.calls).toEqual([["suggestions", "conversation", true, "opus"]]);
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

test("a precompute spends the daily budget and stops once it is gone; a user's request never spends it", async () => {
  let left = 1;
  const h = fixture({ budget: { take: () => left-- > 0 }, now: () => 60_000 });
  (h.context.row as { createdAt: number }).createdAt = 59_000;
  await h.handlers.suggestions.execute(h.context, { kind: "suggestions", model: "opus", refresh: false, precompute: true });
  await expect(h.handlers.suggestions.execute(h.context, { kind: "suggestions", model: "opus", refresh: false, precompute: true }))
    .rejects.toThrow("Daily suggestion precompute cap reached");
  await h.handlers.suggestions.execute(h.context, { kind: "suggestions", model: "opus", refresh: false });
  expect(h.calls).toHaveLength(2);
});

test("a precompute that waited out the AI process's downtime is dropped without a model call or budget", async () => {
  let spent = 0;
  const h = fixture({ budget: { take: () => ++spent > 0 }, now: () => 10 * 60_000 });
  (h.context.row as { createdAt: number }).createdAt = 60_000;
  await expect(h.handlers.suggestions.execute(h.context, { kind: "suggestions", model: "opus", refresh: false, precompute: true }))
    .rejects.toThrow("Suggestion precompute expired");
  expect([h.calls.length, spent]).toEqual([0, 0]);
});

test("identify asks the service about the conversation", async () => {
  const h = fixture();
  expect(await h.handlers.identify.execute(h.context)).toEqual({ kind: "identify", contact: { name: "Alex", confidence: "high", reasoning: "Mini vault lookup" } });
  expect(h.calls).toEqual([["identify", "conversation"]]);
  expect(h.handlers.identify.longRunning).toBe(true);
});

test("feedback passes the command key to local dedupe and surfaces lineage rejection", async () => {
  const h = fixture();
  const feedback: SuggestionFeedbackRequest = {
    suggestion: { id: "s1", kind: "text", strategy: "clarify", vibe: "curious", text: "what time works?", reaction: null, targetMessageGuid: null, targetMessagePreview: null, targetPartIndex: null },
    selectedModel: "opus", servedModel: "opus", recipeVersion: 3, selectedAt: 1, finalText: "unrelated",
  };
  await expect(h.handlers.suggestionFeedback.execute(h.context, { kind: "suggestionFeedback", feedback })).rejects.toThrow("suggestion attribution was abandoned");
  expect(h.calls[0]).toEqual(["feedback", "conversation", feedback, "client-key"]);
  const reaction = { ...feedback, suggestion: { ...feedback.suggestion, kind: "reaction" as const, reaction: "like" as const } };
  expect(await h.handlers.suggestionFeedback.execute(h.context, { kind: "suggestionFeedback", feedback: reaction })).toEqual({ kind: "suggestionFeedback", ok: true });
  expect(h.calls[1]).toEqual(["reaction", "conversation", reaction, "client-key"]);
});

test("clear is global and waits until published shelves have been invalidated", async () => {
  const h = fixture();
  h.context.conversationId = null;
  expect(await h.handlers.clearSuggestionLearning.execute(h.context)).toEqual({ kind: "clearSuggestionLearning", ok: true });
  expect(h.calls).toEqual([["clear", "client-key"]]);
  expect(h.publications).toEqual([{ kind: "clear", clientKey: "client-key", clearedAt: 1 }]);
});

test("transcribe publishes working before awaiting the terminal result and supports retries", async () => {
  const states: TranscriptState[] = [];
  let release: (state: TranscriptState) => void = () => {};
  let job = new Promise<TranscriptState>((resolve) => { release = resolve; });
  const post: typeof postMedia = async (_, request) => { if (request.kind === "transcript") { expect(request.conversationId).toBe("conversation" as never); states.push(request.transcript); } return true; };
  const { handlers, context } = fixture({ post, whisper: { transcribe: () => job } });
  const pending = handlers.transcribe.execute(context, { kind: "transcribe", attachmentGuid: "memo" });
  await Bun.sleep(0);
  expect(states).toEqual([{ state: "working" }]);
  release({ state: "failed", error: "conversion failed" });
  expect(await pending).toEqual({ kind: "transcribe", transcript: { state: "failed", error: "conversion failed" } });
  job = Promise.resolve({ state: "ready", text: "hello" });
  expect(await handlers.transcribe.execute(context, { kind: "transcribe", attachmentGuid: "memo" })).toEqual({ kind: "transcribe", transcript: { state: "ready", text: "hello" } });
  expect(states.map((s) => s.state)).toEqual(["working", "failed", "working", "ready"]);
  expect(handlers.transcribe.longRunning).toBe(true);
});

test("transcribe publishes unavailable and thrown terminal failures", async () => {
  const states: TranscriptState[] = [];
  const post: typeof postMedia = async (_, request) => { if (request.kind === "transcript") states.push(request.transcript); return true; };
  const unavailable = fixture({ post });
  expect((await unavailable.handlers.transcribe.execute(unavailable.context, { kind: "transcribe", attachmentGuid: "memo" })).transcript.state).toBe("unavailable");
  const failed = fixture({ post, whisper: { transcribe: async () => { throw new Error("lost worker"); } } });
  await failed.handlers.transcribe.execute(failed.context, { kind: "transcribe", attachmentGuid: "memo" });
  expect(states.at(-1)).toEqual({ state: "failed", error: "lost worker" });
});
