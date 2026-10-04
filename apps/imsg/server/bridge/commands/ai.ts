import type { AiService } from "../../ai/service";
import { publishShelf } from "../suggestions";
import { requireChat, type HandlerMap } from "./types";

export interface AiCommandDeps {
  ai: Pick<AiService, "replySuggestions" | "identify" | "recordSuggestionFeedback" | "recordReactionFeedback" | "clearSuggestionLearning">;
  refreshContacts?: () => Promise<unknown>;
  now?: () => number;
}

export function createAiHandlers(deps?: AiCommandDeps) {
  const service = () => {
    if (!deps) throw new Error("not implemented");
    return deps.ai;
  };
  const now = () => (deps?.now ?? Date.now)();
  return {
    suggestions: {
      longRunning: true,
      execute: async (context, payload) => {
        const startedAt = now();
        const chatGuid = requireChat(context);
        const summaries = await context.commands.directory.summaries();
        if (!summaries.ok) throw new Error(summaries.error);
        const chat = summaries.chats.find((row) => row.guid === chatGuid);
        const generated = await service().replySuggestions(chatGuid, chat?.isGroup ? null : chat?.displayName ?? null, payload.refresh, payload.model);
        if (!generated.ok) throw new Error(generated.error);
        context.signal.throwIfAborted();
        const suggestions = generated.value;
        if (!suggestions.stale && suggestions.basedOnMessageGuid && !chat?.lastMessage?.isFromMe) {
          const published = await publishShelf(context.writer.deps.ingest, {
            kind: "publish", conversationId: context.row.conversationId!, model: payload.model, suggestions, startedAt,
          });
          if (!published) return { kind: "suggestions", suggestions: { ...suggestions, stale: true } };
        }
        return { kind: "suggestions", suggestions };
      },
    },
    identify: {
      longRunning: true,
      execute: async (context) => {
        const chatGuid = requireChat(context);
        const chat = await context.commands.bb.getChat(chatGuid);
        if (!chat.ok) throw new Error(chat.error);
        const address = chat.value.participants?.[0]?.address;
        if (!address) throw new Error("no participant address");
        if (deps?.refreshContacts) await deps.refreshContacts();
        else await context.commands.directory.summaries();
        const result = await service().identify(chatGuid, address, context.writer.deps.names?.lookup(address) ?? null);
        if (!result.ok) throw new Error(result.error);
        context.signal.throwIfAborted();
        return { kind: "identify", contact: result.value };
      },
    },
    suggestionFeedback: {
      execute: async (context, { feedback }) => {
        const chatGuid = requireChat(context);
        const ai = service();
        if (feedback.suggestion.kind === "reaction") ai.recordReactionFeedback(chatGuid, feedback, context.row.clientKey);
        else {
          const result = ai.recordSuggestionFeedback(chatGuid, feedback, context.row.clientKey);
          if (!result.ok) throw new Error(result.error);
        }
        return { kind: "suggestionFeedback", ok: true };
      },
    },
    clearSuggestionLearning: {
      execute: async (context) => {
        service().clearSuggestionLearning(context.row.clientKey);
        await publishShelf(context.writer.deps.ingest, { kind: "clear", clientKey: context.row.clientKey, clearedAt: now() });
        return { kind: "clearSuggestionLearning", ok: true };
      },
    },
  } satisfies Pick<HandlerMap, "suggestions" | "identify" | "suggestionFeedback" | "clearSuggestionLearning">;
}

// The composition owner injects the Mini's service with createAiHandlers.
export const aiHandlers = createAiHandlers();
