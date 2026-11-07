import { makeFunctionReference, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server";
import type { suggestionDoc } from "../../../../../convex/schema/comma/validators";
import type { AiStatus, ContactSuggestion, ConversationId, ReplySuggestions, SuggestionFeedbackRequest, SuggestionModel } from "@shared/types";
import { commaOutbox } from "./convex-api";
import { runCommand } from "./convex-commands";

export type SuggestionShelfRow = typeof suggestionDoc.type;

export const aiApi = {
  getSuggestions: makeFunctionReference<"query", { conversationId: ConversationId; model: SuggestionModel }, SuggestionShelfRow | null>("comma/suggestions:getSuggestions"),
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

export function feedbackClientKey(conversationId: ConversationId, feedback: SuggestionFeedbackRequest): string {
  return `suggestion-feedback-${JSON.stringify([conversationId, feedback.suggestion.id, feedback.selectedModel,
    feedback.servedModel, feedback.recipeVersion, feedback.selectedAt, feedback.finalText])}`;
}

export function createAiApi(client: AiClient, run: typeof runCommand = runCommand) {
  return {
    aiStatus: (): Promise<AiStatus> => client.query(aiApi.aiStatus, {}),
    async aiSuggestions(conversationId: ConversationId, model: SuggestionModel, refresh = false): Promise<ReplySuggestions> {
      if (!refresh) {
        const cached = shelfSuggestions(await client.query(aiApi.getSuggestions, { conversationId, model }));
        if (cached) return cached;
      }
      return (await run(conversationId, { kind: "suggestions", model, refresh })).suggestions;
    },
    async recordSuggestionFeedback(conversationId: ConversationId, feedback: SuggestionFeedbackRequest): Promise<{ ok: boolean }> {
      await client.mutation(commaOutbox.enqueue, {
        clientKey: feedbackClientKey(conversationId, feedback), conversationId,
        payload: { kind: "suggestionFeedback", feedback },
      });
      return { ok: true };
    },
    async clearSuggestionLearning(): Promise<{ ok: boolean }> {
      const result = await run(null, { kind: "clearSuggestionLearning" });
      return { ok: result.ok };
    },
    async aiIdentify(conversationId: ConversationId): Promise<ContactSuggestion> {
      return (await run(conversationId, { kind: "identify" })).contact;
    },
  };
}

export async function sendWithSuggestionFeedback<T>(send: () => Promise<T>, feedback: () => Promise<unknown>): Promise<T> {
  const result = await send();
  try { void feedback().catch(() => undefined); } catch { /* Feedback cannot turn a confirmed send into a failure. */ }
  return result;
}
