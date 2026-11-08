import type { TranscriptState } from "../../../shared/types";
import type { AiService } from "../../ai/service";
import type { WhisperService } from "../../whisper";
import { publishShelf, type PrecomputeBudget } from "../suggestions";
import { postMedia } from "./media";
import { requireConversation, type AiHandlers } from "./types";

export interface AiCommandDeps {
  ai: Pick<AiService, "replySuggestions" | "identify" | "recordSuggestionFeedback" | "recordReactionFeedback" | "clearSuggestionLearning">;
  whisper?: Pick<WhisperService, "transcribe">;
  /** Convex's precompute commands spend it; a command the user asked for never does. */
  budget?: Pick<PrecomputeBudget, "take">;
  post?: typeof postMedia;
  now?: () => number;
}

const PRECOMPUTE_STALE_MS = 2 * 60_000;

export function createAiHandlers(deps: AiCommandDeps) {
  const service = () => deps.ai;
  const now = () => (deps.now ?? Date.now)();
  const post = deps.post ?? postMedia;
  return {
    suggestions: {
      longRunning: true,
      execute: async (context, payload) => {
        const startedAt = now();
        const conversationId = requireConversation(context);
        if (payload.precompute) {
          // A precompute queued while this process was down answers a moment that has passed.
          if (context.row.createdAt < now() - PRECOMPUTE_STALE_MS) throw new Error("Suggestion precompute expired");
          if (deps.budget && !deps.budget.take()) throw new Error("Daily suggestion precompute cap reached");
        }
        const generated = await service().replySuggestions(conversationId, payload.refresh, payload.model);
        if (!generated.ok) throw new Error(generated.error);
        context.signal.throwIfAborted();
        const suggestions = generated.value;
        if (!suggestions.stale && suggestions.basedOnMessageGuid) {
          // Convex refuses a shelf whose conversation has moved on or ends with my own message.
          const published = await publishShelf(context.ingest, { kind: "publish", conversationId, model: payload.model, suggestions, startedAt });
          if (!published) return { kind: "suggestions", suggestions: { ...suggestions, stale: true } };
        }
        return { kind: "suggestions", suggestions };
      },
    },
    identify: {
      longRunning: true,
      execute: async (context) => {
        const result = await service().identify(requireConversation(context));
        if (!result.ok) throw new Error(result.error);
        context.signal.throwIfAborted();
        return { kind: "identify", contact: result.value };
      },
    },
    suggestionFeedback: {
      execute: async (context, { feedback }) => {
        const conversationId = requireConversation(context);
        const ai = service();
        if (feedback.suggestion.kind === "reaction") ai.recordReactionFeedback(conversationId, feedback, context.row.clientKey);
        else {
          const result = ai.recordSuggestionFeedback(conversationId, feedback, context.row.clientKey);
          if (!result.ok) throw new Error(result.error);
        }
        return { kind: "suggestionFeedback", ok: true };
      },
    },
    clearSuggestionLearning: {
      execute: async (context) => {
        service().clearSuggestionLearning(context.row.clientKey);
        await publishShelf(context.ingest, { kind: "clear", clientKey: context.row.clientKey, clearedAt: now() });
        return { kind: "clearSuggestionLearning", ok: true };
      },
    },
    transcribe: {
      longRunning: true,
      execute: async (context, payload) => {
        const conversationId = requireConversation(context);
        const publish = async (transcript: TranscriptState) => {
          const found = await post(context.ingest, { kind: "transcript", attachmentGuid: payload.attachmentGuid, conversationId, transcript });
          if (!found) throw new Error("Attachment is not mirrored yet");
        };
        await publish({ state: "working" });
        let transcript: TranscriptState;
        try {
          transcript = deps.whisper ? await deps.whisper.transcribe(payload.attachmentGuid, conversationId) : { state: "unavailable", detail: "Whisper service is unavailable" };
        } catch (error) {
          transcript = { state: "failed", error: error instanceof Error ? error.message : String(error) };
        }
        await publish(transcript);
        return { kind: "transcribe", transcript };
      },
    },
  } satisfies AiHandlers;
}
