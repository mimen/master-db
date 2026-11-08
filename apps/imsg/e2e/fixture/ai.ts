import { Gateway } from "../../server/ai/gateway";
import { AiService, type ConversationId } from "../../server/ai/service";
import type { AiServiceLike } from "../../server/app";
import type { Result } from "../../server/bluebubbles";
import type { OverlayDb } from "../../server/db";
import { buildThread } from "../../server/map";
import type {
  ContactSuggestion,
  ReplySuggestions,
  SuggestionFeedbackRequest,
  SuggestionModel,
} from "../../shared/types";
import type { FixtureBlueBubbles } from "./fake-bluebubbles";
import { FIXTURE_NOW, type FixtureIdentity } from "./world";

export class FixtureAi implements AiServiceLike {
  readonly available = true;
  /** When set, suggestions run the real AiService and Gateway against the fixture's model endpoint, which answers after this delay. */
  modelDelayMs: number | null = null;
  private readonly live: AiService | null;

  // A fixture conversation id is its chat guid, and a direct chat's guid ends in the address.
  constructor(db: OverlayDb, private readonly names?: FixtureIdentity, model?: { bb: FixtureBlueBubbles; gatewayUrl: string }) {
    const config = { gatewayUrl: model?.gatewayUrl ?? "", gatewayKey: "fixture", fastModel: "fixture", vaultPath: "/nonexistent-vault" };
    this.live = model && names ? new AiService({
      config, db, gateway: new Gateway(config),
      fetchThread: async (conversationId) => {
        const raw = await model.bb.chatMessages(conversationId, { limit: Number.MAX_SAFE_INTEGER });
        if (!raw.ok) return raw;
        return { ok: true, value: { title: "Fixture", isGroup: false, participants: [], route: { platform: "imessage", chatGuid: conversationId }, messages: buildThread(raw.value, conversationId, names) } };
      },
      sentText: async () => [],
      bridgeSupport: () => ({ privateApi: model.bb.hasPrivateApi }),
      contactEmails: () => [],
      searchVault: async () => [],
    }) : null;
  }

  replySuggestions(
    conversationId: ConversationId,
    force: boolean,
    selectedModel: SuggestionModel,
  ): Promise<Result<ReplySuggestions>> {
    if (this.live && this.modelDelayMs !== null) return this.live.replySuggestions(conversationId, force, selectedModel);
    const target = conversationId.includes("50101") ? "needs-2" : "fixture-inbound";
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

  recordSuggestionFeedback(_conversationId: ConversationId, _request: SuggestionFeedbackRequest): Result<true> {
    return { ok: true, value: true };
  }

  recordReactionFeedback(_conversationId: ConversationId, _request: Omit<SuggestionFeedbackRequest, "finalText">): void {}

  clearSuggestionLearning(): void {}

  identify(conversationId: ConversationId): Promise<Result<ContactSuggestion>> {
    const knownName = this.names?.lookup(conversationId.slice(conversationId.lastIndexOf(";") + 1)) ?? null;
    return Promise.resolve({
      ok: true,
      value: { name: knownName, confidence: knownName ? "high" : "low", reasoning: "Deterministic fixture identity." },
    });
  }
}
