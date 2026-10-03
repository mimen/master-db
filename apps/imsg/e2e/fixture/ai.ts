import type { AiServiceLike } from "../../server/app";
import type { Result } from "../../server/bluebubbles";
import type { OverlayDb } from "../../server/db";
import type {
  ContactSuggestion,
  ReplySuggestions,
  SuggestionFeedbackRequest,
  SuggestionModel,
} from "../../shared/types";
import { FIXTURE_NOW } from "./world";

export class FixtureAi implements AiServiceLike {
  readonly available = true;

  constructor(_db: OverlayDb) {}

  replySuggestions(
    chatGuid: string,
    _peerName: string | null,
    _force: boolean,
    selectedModel: SuggestionModel,
  ): Promise<Result<ReplySuggestions>> {
    const target = chatGuid.includes("50101") ? "needs-2" : "fixture-inbound";
    return Promise.resolve({
      ok: true,
      value: {
        recipeVersion: 3,
        selectedModel,
        servedModel: selectedModel === "opus" ? "terra" : "terra",
        fallback: selectedModel === "opus",
        noReply: false,
        suggestions: [
          { id: "fixture-curious", kind: "text", strategy: "clarify", vibe: "curious", text: "what time do you need the final answer by?", reaction: null, targetMessageGuid: null, targetMessagePreview: null, targetPartIndex: null },
          { id: "fixture-boundary", kind: "text", strategy: "decline", vibe: "boundary", text: "that turnaround is too tight on my end", reaction: null, targetMessageGuid: null, targetMessagePreview: null, targetPartIndex: null },
          { id: "fixture-reaction", kind: "reaction", strategy: "react", vibe: "playful", text: "thumbs up", reaction: "like", targetMessageGuid: target, targetMessagePreview: "Can you send the final arrival time?", targetPartIndex: 0 },
        ],
        basedOnMessageGuid: target,
        stale: false,
        generatedAt: FIXTURE_NOW,
      },
    });
  }

  recordSuggestionFeedback(_chatGuid: string, _request: SuggestionFeedbackRequest): Result<true> {
    return { ok: true, value: true };
  }

  recordReactionFeedback(_chatGuid: string, _request: Omit<SuggestionFeedbackRequest, "finalText">): void {}

  clearSuggestionLearning(): void {}

  identify(_chatGuid: string, _address: string, knownName: string | null): Promise<Result<ContactSuggestion>> {
    return Promise.resolve({
      ok: true,
      value: { name: knownName, confidence: knownName ? "high" : "low", reasoning: "Deterministic fixture identity." },
    });
  }
}
