import type { AiServiceLike } from "../../server/app";
import type { Result } from "../../server/bluebubbles";
import type { OverlayDb } from "../../server/db";
import type {
  ContactSuggestion,
  ReplySuggestions,
  ShadowBrief,
  SuggestionFeedbackRequest,
  SuggestionModel,
  SmartCloser,
} from "../../shared/types";
import { FIXTURE_NOW } from "./world";

export class FixtureAi implements AiServiceLike {
  readonly available = true;

  constructor(private readonly db: OverlayDb) {}

  groupNames(_chatGuid: string, _participants: string[]): Promise<Result<string[]>> {
    return Promise.resolve({ ok: true, value: ["Launch Crew", "Show Team", "Run of Show"] });
  }

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

  smartCloser(chatGuid: string): Promise<Result<SmartCloser>> {
    if (chatGuid.includes("50101")) {
      return Promise.resolve({ ok: true, value: { kind: "reply", label: "Send arrival time", draft: "Doors are at 8. I’ll be there by 7:15." } });
    }
    if (chatGuid.includes("fixture-crew")) {
      return Promise.resolve({ ok: true, value: { kind: "react_done", label: "👍 & done", reaction: "👍" } });
    }
    const finalDigit = Number(chatGuid.at(-1) ?? "0");
    const variants: SmartCloser[] = [
      { kind: "reply", label: "Send confirmation", draft: "Yes — confirmed. I’ll send the final details shortly." },
      { kind: "call", label: "Call them" },
      { kind: "react_done", label: "👍 & done", reaction: "👍" },
      { kind: "later", label: "Later today" },
    ];
    return Promise.resolve({ ok: true, value: variants[finalDigit % variants.length] ?? variants[0]! });
  }

  shadowBrief(_chatGuid: string, _force: boolean): Promise<Result<ShadowBrief>> {
    return Promise.resolve({
      ok: true,
      value: {
        context: "Arrival timing is the only open item. The walkthrough is already confirmed.",
        actionItems: ["Confirm the final arrival window", "Send it to Alex"],
        draft: "Doors are at 8. I’ll arrive by 7:15 for the final walkthrough.",
        basedOnMessageGuid: "needs-2",
      },
    });
  }

  shadowPending(_chatGuid: string): boolean {
    return false;
  }

  shadowEnqueue(chatGuid: string, text: string, _peerName: string | null): Promise<void> {
    this.db.addShadowMessage(`fixture-user-${FIXTURE_NOW}`, chatGuid, "user", text);
    this.db.addShadowMessage(
      `fixture-assistant-${FIXTURE_NOW}`,
      chatGuid,
      "assistant",
      "The fixture shadow lane is deterministic and does not launch CCS.",
    );
    return Promise.resolve();
  }
}
