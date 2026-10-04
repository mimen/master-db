import { makeFunctionReference, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server";
import type { suggestionDoc } from "../../../../../convex/schema/comma/validators";
import type { AiStatus, ContactSuggestion, ReplySuggestions, SuggestionFeedbackRequest, SuggestionModel } from "@shared/types";
import { commaApi, commaOutbox } from "./convex-api";
import { runCommand } from "./convex-commands";

export type SuggestionShelfRow = typeof suggestionDoc.type;

export const aiApi = {
  getSuggestions: makeFunctionReference<"query", { chatGuid: string; model: SuggestionModel }, SuggestionShelfRow | null>("comma/suggestions:getSuggestions"),
  aiStatus: makeFunctionReference<"query", Record<string, never>, AiStatus>("comma/suggestions:aiStatus"),
};

export function shelfSuggestions(row: SuggestionShelfRow | null | undefined): ReplySuggestions | null | undefined {
  if (!row) return row;
  // Legacy shelves use string validators; the Mini writes validated ReplySuggestions.
  return { ...row.payload, basedOnMessageGuid: row.anchorGuid, stale: false, generatedAt: row.createdAt } as ReplySuggestions;
}

interface AiClient {
  query<Ref extends FunctionReference<"query">>(ref: Ref, args: FunctionArgs<Ref>): Promise<FunctionReturnType<Ref>>;
  mutation<Ref extends FunctionReference<"mutation">>(ref: Ref, args: FunctionArgs<Ref>): Promise<FunctionReturnType<Ref>>;
}

export function feedbackClientKey(chatGuid: string, feedback: SuggestionFeedbackRequest): string {
  return `suggestion-feedback-${JSON.stringify([chatGuid, feedback.suggestion.id, feedback.selectedModel,
    feedback.servedModel, feedback.recipeVersion, feedback.selectedAt, feedback.finalText])}`;
}

export function createAiApi(client: AiClient, run: typeof runCommand = runCommand) {
  return {
    aiStatus: (): Promise<AiStatus> => client.query(aiApi.aiStatus, {}),
    async aiSuggestions(chatGuid: string, model: SuggestionModel, refresh = false): Promise<ReplySuggestions> {
      if (!refresh) {
        const cached = shelfSuggestions(await client.query(aiApi.getSuggestions, { chatGuid, model }));
        if (cached) return cached;
      }
      return (await run(chatGuid, { kind: "suggestions", model, refresh })).suggestions;
    },
    async recordSuggestionFeedback(chatGuid: string, feedback: SuggestionFeedbackRequest): Promise<{ ok: boolean }> {
      const conversation = await client.query(commaApi.resolveChat, { chatGuid });
      if (!conversation) throw new Error("Conversation is not mirrored yet");
      await client.mutation(commaOutbox.enqueue, {
        clientKey: feedbackClientKey(chatGuid, feedback), conversationId: conversation._id,
        payload: { kind: "suggestionFeedback", feedback },
      });
      return { ok: true };
    },
    async clearSuggestionLearning(): Promise<{ ok: boolean }> {
      const result = await run(null, { kind: "clearSuggestionLearning" });
      return { ok: result.ok };
    },
    async aiIdentify(chatGuid: string): Promise<ContactSuggestion> {
      return (await run(chatGuid, { kind: "identify" })).contact;
    },
  };
}

export async function sendWithSuggestionFeedback<T>(send: () => Promise<T>, feedback: () => Promise<unknown>): Promise<T> {
  const result = await send();
  try { void feedback().catch(() => undefined); } catch { /* Feedback cannot turn a confirmed send into a failure. */ }
  return result;
}
