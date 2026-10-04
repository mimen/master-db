import { expect, test } from "bun:test";
import { getFunctionName, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server";
import type { GenericId } from "convex/values";
import type { ReplySuggestions, SuggestionFeedbackRequest } from "@shared/types";
import type { CommandPayload, RunCommandOptions, runCommand } from "./convex-commands";
import type { ResultFor } from "./command-results";
import { createAiApi, feedbackClientKey, sendWithSuggestionFeedback, type SuggestionShelfRow } from "./ai-api";

function suggestions(model: "opus" | "terra"): ReplySuggestions {
  return { suggestions: [], event: null, recipeVersion: 3, selectedModel: model, servedModel: model,
    fallback: false, noReply: false, basedOnMessageGuid: "m1", stale: false, generatedAt: 1 };
}
function shelf(model: "opus" | "terra"): SuggestionShelfRow {
  const { basedOnMessageGuid, stale: _stale, generatedAt, ...payload } = suggestions(model);
  return { _id: "shelf" as GenericId<"comma_suggestions">, _creationTime: 1, conversationId: "conversation" as GenericId<"comma_conversations">,
    model, anchorGuid: basedOnMessageGuid!, createdAt: generatedAt, payload };
}
function feedback(): SuggestionFeedbackRequest {
  return { suggestion: { id: "s1", kind: "text", strategy: "clarify", vibe: "curious", text: "what time works?",
    reaction: null, targetMessageGuid: null, targetMessagePreview: null, targetPartIndex: null },
    selectedModel: "opus", servedModel: "terra", recipeVersion: 3, selectedAt: 1, finalText: "what time works for you?" };
}
function fixture() {
  const reads: Array<{ name: string; args: unknown }> = [];
  const writes: Array<{ name: string; args: unknown }> = [];
  const commands: Array<{ chatGuid: string | null; payload: CommandPayload; options?: RunCommandOptions }> = [];
  const cache = new Map<string, SuggestionShelfRow>();
  const client: Parameters<typeof createAiApi>[0] = {
    async query<Ref extends FunctionReference<"query">>(ref: Ref, args: FunctionArgs<Ref>): Promise<FunctionReturnType<Ref>> {
      const name = getFunctionName(ref);
      reads.push({ name, args });
      const value = name === "comma/queries:resolveChat" ? { _id: "conversation" } : name === "comma/suggestions:aiStatus"
        ? { suggestions: false, reactionSuggestions: false } : cache.get((args as { model: string }).model) ?? null;
      return value as FunctionReturnType<Ref>;
    },
    async mutation<Ref extends FunctionReference<"mutation">>(ref: Ref, args: FunctionArgs<Ref>): Promise<FunctionReturnType<Ref>> {
      writes.push({ name: getFunctionName(ref), args });
      return "outbox" as FunctionReturnType<Ref>;
    },
  };
  const run: typeof runCommand = async <P extends CommandPayload>(chatGuid: string | null, payload: P, options?: RunCommandOptions): Promise<ResultFor<P["kind"]>> => {
    commands.push({ chatGuid, payload, options });
    const result = payload.kind === "suggestions" ? { kind: "suggestions", suggestions: suggestions(payload.model) }
      : payload.kind === "identify" ? { kind: "identify", contact: { name: "Alex", confidence: "high", reasoning: "vault" } }
      : { kind: payload.kind, ok: true };
    return result as ResultFor<P["kind"]>;
  };
  return { api: createAiApi(client, run), reads, writes, commands, cache };
}

test("reads the selected model's Convex cache first, commands cache misses, and forces refresh", async () => {
  const h = fixture();
  h.cache.set("opus", shelf("opus"));
  expect(await h.api.aiSuggestions("chat", "opus")).toEqual(suggestions("opus"));
  expect(h.commands).toEqual([]);
  expect(await h.api.aiSuggestions("chat", "terra")).toEqual(suggestions("terra"));
  expect(h.commands[0]).toMatchObject({ chatGuid: "chat", payload: { kind: "suggestions", model: "terra", refresh: false } });
  const reads = h.reads.length;
  await h.api.aiSuggestions("chat", "opus", true);
  expect(h.reads).toHaveLength(reads);
  expect(h.commands[1]?.payload).toEqual({ kind: "suggestions", model: "opus", refresh: true });
});

test("feedback is queued without waiting for execution and uses a stable dedupe key", async () => {
  const h = fixture();
  const body = feedback();
  expect(await h.api.recordSuggestionFeedback("chat", body)).toEqual({ ok: true });
  await h.api.recordSuggestionFeedback("chat", JSON.parse(JSON.stringify(body)) as SuggestionFeedbackRequest);
  expect(h.commands).toEqual([]);
  expect(h.writes).toHaveLength(2);
  expect(h.writes[0]).toEqual(h.writes[1]);
  expect(h.writes[0]).toMatchObject({ name: "comma/outbox:enqueue", args: { clientKey: feedbackClientKey("chat", body), payload: { kind: "suggestionFeedback", feedback: body } } });
  expect(feedbackClientKey("chat", { ...body, selectedAt: 2 })).not.toBe(feedbackClientKey("chat", body));
});

test("feedback runs only after a confirmed send and never after a rejected send", async () => {
  const h = fixture();
  let confirm!: () => void;
  const confirmation = new Promise<void>((resolve) => { confirm = resolve; });
  const sent = sendWithSuggestionFeedback(() => confirmation, () => h.api.recordSuggestionFeedback("chat", feedback()));
  await Promise.resolve();
  expect(h.writes).toEqual([]);
  confirm();
  await sent;
  await Promise.resolve();
  expect(h.writes).toHaveLength(1);
  await expect(sendWithSuggestionFeedback(async () => { throw new Error("send failed"); }, () => h.api.recordSuggestionFeedback("chat", feedback()))).rejects.toThrow("send failed");
  expect(h.writes).toHaveLength(1);
  expect(await sendWithSuggestionFeedback(async () => "confirmed", async () => { throw new Error("feedback unavailable"); })).toBe("confirmed");
  expect(await sendWithSuggestionFeedback(async () => "confirmed", () => { throw new Error("feedback unavailable"); })).toBe("confirmed");
});

test("global clear waits for its result, identify preserves its shape, and status queries capability", async () => {
  const h = fixture();
  expect(await h.api.clearSuggestionLearning()).toEqual({ ok: true });
  expect(h.commands[0]).toMatchObject({ chatGuid: null, payload: { kind: "clearSuggestionLearning" } });
  expect(await h.api.aiIdentify("chat")).toEqual({ name: "Alex", confidence: "high", reasoning: "vault" });
  expect(await h.api.aiStatus()).toEqual({ suggestions: false, reactionSuggestions: false });
  expect(h.reads.at(-1)?.name).toBe("comma/suggestions:aiStatus");
});
