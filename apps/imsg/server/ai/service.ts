import type { GenericId } from "convex/values";
import type { Result } from "../bluebubbles";
import type { AiConfig } from "../config";
import type { OverlayDb, SuggestionFeedbackRow } from "../db";
import type {
  ContactSuggestion,
  EventSuggestion,
  Message,
  ReplySuggestions,
  SuggestionFeedbackRequest,
  SuggestionModel,
} from "../../shared/types";
import { loadProfile, renderSuggestionContext, renderTranscript } from "./context";
import { Gateway, type GatewayFailure } from "./gateway";
import { contactCandidate, mergeCandidates, vaultCandidates } from "./identify";
import { identifyPrompt } from "./prompts";
import {
  SUGGESTION_MODELS,
  SUGGESTION_RECIPE_VERSION,
  SUGGESTION_SCHEMA,
  extractEventSuggestion,
  formatPromptNow,
  suggestionPrompt,
  validateSuggestionSet,
} from "./suggestions";
import { loadVoiceState } from "./voice";

/**
 * Orchestration for both AI lanes. Everything the routes need lives here so
 * `index.ts` stays a routing table.
 */

export interface AiDeps {
  config: AiConfig;
  db: OverlayDb;
  gateway: Gateway;
  /** The conversation from Convex; read errors must remain distinguishable from an empty thread. */
  fetchThread: (conversationId: ConversationId) => Promise<Result<AiThread>>;
  /** Recent global outbound text, reduced locally into aggregate style. */
  recentOutboundText: () => Promise<string[]>;
  /** BlueBubbles Private API supports outbound tapbacks. */
  reactionSuggestions: () => boolean;
  /** Contact emails for an iMessage address, [] when unknown. */
  contactEmails: (address: string) => string[];
  /** Vault grep, injected so tests never touch the filesystem. */
  searchVault: (pattern: string) => Promise<Array<{ path: string; line: string }>>;
}

export type ConversationId = GenericId<"comma_conversations">;

/** Newest-last messages with folded reactions, and the participants' names (null when unknown). */
export interface AiThread {
  title: string;
  isGroup: boolean;
  participants: Array<{ address: string; name: string | null }>;
  messages: Message[];
}

/**
 * D5: a shelf is stale when messages have arrived since it was generated.
 * Comparing the anchor guid rather than a timestamp means a burst of five
 * messages marks the shelf stale once, instead of firing five regenerations.
 */
export function isStale(cachedGuid: string | null, currentGuid: string | null): boolean {
  return cachedGuid !== currentGuid;
}

function lastGuid(messages: Message[]): string | null {
  return messages[messages.length - 1]?.guid ?? null;
}

interface SuggestionCachePayload {
  recipeVersion: number;
  selectedModel: SuggestionModel;
  servedModel: SuggestionModel;
  fallback: boolean;
  noReply: boolean;
  suggestions: ReplySuggestions["suggestions"];
  event: EventSuggestion | null;
}

export function serializeSuggestionCache(payload: SuggestionCachePayload): string {
  return JSON.stringify(payload);
}

/** null means corrupt or from an older prompt/context contract. */
export function parseSuggestionCache(payload: string): SuggestionCachePayload | null {
  try {
    const parsed = JSON.parse(payload) as SuggestionCachePayload;
    if (
      parsed.recipeVersion !== SUGGESTION_RECIPE_VERSION ||
      (parsed.selectedModel !== "opus" && parsed.selectedModel !== "terra") ||
      (parsed.servedModel !== "opus" && parsed.servedModel !== "terra") ||
      typeof parsed.fallback !== "boolean" ||
      typeof parsed.noReply !== "boolean" ||
      !Array.isArray(parsed.suggestions) ||
      !isValidCachedEvent(parsed.event)
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isValidCachedEvent(event: SuggestionCachePayload["event"]): boolean {
  if (event === null) return true;
  return (
    typeof event === "object" &&
    typeof event.title === "string" &&
    typeof event.start === "string" &&
    typeof event.durationMinutes === "number" &&
    (event.location === null || typeof event.location === "string") &&
    Array.isArray(event.inviteEmails) &&
    event.inviteEmails.every((email) => typeof email === "string")
  );
}

export class AiService {
  private suggestionInFlight = new Map<string, Promise<Result<ReplySuggestions>>>();
  private learningEpoch = 0;
  private aiActive = 0;
  private aiWaiters: Array<() => void> = [];
  private readonly aiConcurrency = 2;

  constructor(private deps: AiDeps) {}

  get available(): boolean {
    return this.deps.gateway.available;
  }

  /** Returns the selected route's cached shelf unless it is missing, or `force` is set. */
  async replySuggestions(
    conversationId: ConversationId,
    force: boolean,
    selectedModel: SuggestionModel,
  ): Promise<Result<ReplySuggestions>> {
    const fetched = await this.deps.fetchThread(conversationId);
    if (!fetched.ok) return fetched;
    const { messages } = fetched.value;
    const peerName = fetched.value.isGroup ? null : fetched.value.title;
    const currentGuid = lastGuid(messages);
    if (!currentGuid) return { ok: false, error: "chat has no messages" };
    if (messages[messages.length - 1]?.isFromMe) {
      return {
        ok: true,
        value: emptySuggestions(selectedModel, currentGuid),
      };
    }
    const voice = loadVoiceState(this.deps.db, await this.deps.recentOutboundText());
    const cached = force ? null : await this.cachedReplySuggestions(conversationId, currentGuid, selectedModel, voice);
    if (cached) return { ok: true, value: cached };

    const key = [
      conversationId,
      currentGuid,
      selectedModel,
      SUGGESTION_RECIPE_VERSION,
      voice.voiceRevision,
      voice.editRevision,
      this.learningEpoch,
    ].join(":");
    const existing = this.suggestionInFlight.get(key);
    if (existing) return existing;
    const pending = this.generateReplySuggestions(
      conversationId,
      peerName,
      messages,
      currentGuid,
      selectedModel,
      voice,
      this.learningEpoch,
    );
    this.suggestionInFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.suggestionInFlight.get(key) === pending) this.suggestionInFlight.delete(key);
    }
  }

  async cachedReplySuggestions(
    conversationId: ConversationId,
    anchorGuid: string,
    selectedModel: SuggestionModel,
    voice?: ReturnType<typeof loadVoiceState>,
  ): Promise<ReplySuggestions | null> {
    const cached = this.deps.db.getSuggestionCache(conversationId, selectedModel);
    if (!cached || cached.anchor_guid !== anchorGuid || cached.recipe_version !== SUGGESTION_RECIPE_VERSION) return null;
    const currentVoice = voice ?? loadVoiceState(this.deps.db, await this.deps.recentOutboundText());
    if (cached.voice_revision !== currentVoice.voiceRevision || cached.edit_revision !== currentVoice.editRevision) return null;
    const parsed = parseSuggestionCache(cached.payload);
    return parsed && parsed.selectedModel === selectedModel ? {
      ...parsed, basedOnMessageGuid: anchorGuid, stale: false, generatedAt: cached.created_at,
    } : null;
  }

  private async generateReplySuggestions(
    conversationId: ConversationId,
    peerName: string | null,
    messages: Message[],
    currentGuid: string,
    selectedModel: SuggestionModel,
    voice: ReturnType<typeof loadVoiceState>,
    learningEpoch: number,
  ): Promise<Result<ReplySuggestions>> {
    const [profile, context] = await Promise.all([
      loadProfile(this.deps.config.vaultPath),
      Promise.resolve(renderSuggestionContext(messages, { limit: 60, peerName })),
    ]);
    const prompt = suggestionPrompt({
      context,
      peerName,
      profile,
      globalStyle: context.outboundExamples.length < 4 ? voice.globalStyle : "",
      editRules: voice.editRules,
      reactionSuggestions: this.deps.reactionSuggestions(),
      now: formatPromptNow(new Date()),
    });
    let generated = await this.completeSuggestionWithFallback(prompt, selectedModel);
    if (!generated.ok) {
      const { kind, status, message } = generated.error;
      console.warn(`suggestions ${conversationId} (${selectedModel}): ${kind}${status ? ` ${status}` : ""}: ${message}`);
      return { ok: false, error: message };
    }

    const validate = (value: object) => validateSuggestionSet(value, {
      messages, renderedGuids: context.renderedGuids, reactionSuggestions: this.deps.reactionSuggestions(),
    });
    let validated = validate(generated.value.value);
    if (!validated.ok) {
      const repairPrompt = [
        prompt,
        "",
        `REPAIR: The previous candidates were rejected by local safety checks (${validated.error}).`,
        "Generate a fresh conservative set. Ask for missing information instead of adding any date, number, person, place, status, or commitment not explicitly present in the conversation.",
      ].join("\n");
      const repaired = await this.completeSuggestionWithFallback(repairPrompt, selectedModel);
      if (repaired.ok) {
        generated = repaired;
        validated = validate(repaired.value.value);
      }
    }
    // The event rides the same generation but validates independently, so a
    // rejected reply set still surfaces a grounded scheduling agreement.
    const detected = extractEventSuggestion(generated.value.value, messages, new Date());
    const event = detected ? { ...detected, inviteEmails: this.inviteEmails(messages) } : null;
    const payload: SuggestionCachePayload = {
      recipeVersion: SUGGESTION_RECIPE_VERSION,
      selectedModel,
      servedModel: generated.value.servedModel,
      fallback: generated.value.servedModel !== selectedModel,
      noReply: validated.ok ? validated.value.noReply : false,
      suggestions: validated.ok ? validated.value.suggestions : [],
      event,
    };
    const latest = await this.deps.fetchThread(conversationId);
    if (!latest.ok) return latest;
    const stale = isStale(currentGuid, lastGuid(latest.value.messages)) || learningEpoch !== this.learningEpoch;
    if (!stale && validated.ok) this.deps.db.setSuggestionCache({
      conversation_id: conversationId,
      selected_model: selectedModel,
      anchor_guid: currentGuid,
      recipe_version: SUGGESTION_RECIPE_VERSION,
      voice_revision: voice.voiceRevision,
      edit_revision: voice.editRevision,
      payload: serializeSuggestionCache(payload),
    });
    return {
      ok: true,
      value: {
        ...payload,
        basedOnMessageGuid: currentGuid,
        stale,
        generatedAt: Date.now(),
      },
    };
  }

  /**
   * Everyone on the other side of the thread with a known contact email —
   * first listed email per contact, so one human gets one invitation.
   */
  private inviteEmails(messages: Message[]): string[] {
    const addresses = new Set<string>();
    for (const message of messages) {
      if (!message.isFromMe && message.sender?.address) addresses.add(message.sender.address);
    }
    const emails = new Set<string>();
    for (const address of addresses) {
      const first = this.deps.contactEmails(address)[0];
      if (first) emails.add(first.toLowerCase());
    }
    return [...emails].slice(0, 10);
  }

  private async completeSuggestionWithFallback(
    prompt: string,
    selectedModel: SuggestionModel,
  ): Promise<
    | { ok: true; value: { value: object; servedModel: SuggestionModel } }
    | { ok: false; error: GatewayFailure }
  > {
    const alternate = otherModel(selectedModel);
    const cooldowns = this.routeCooldowns();
    const now = Date.now();
    const first = (cooldowns[selectedModel] ?? 0) > now ? alternate : selectedModel;
    const firstResult = await this.completeSuggestionRoute(prompt, first);
    if (firstResult.ok) return { ok: true, value: { value: firstResult.value, servedModel: first } };
    if (firstResult.error.kind !== "provider") return firstResult;

    this.setRouteCooldown(first, firstResult.error.retryAfterMs);
    const fallback = otherModel(first);
    if ((cooldowns[fallback] ?? 0) > now) return firstResult;
    const fallbackResult = await this.completeSuggestionRoute(prompt, fallback);
    if (!fallbackResult.ok) {
      if (fallbackResult.error.kind === "provider") {
        this.setRouteCooldown(fallback, fallbackResult.error.retryAfterMs);
      }
      return fallbackResult;
    }
    return { ok: true, value: { value: fallbackResult.value, servedModel: fallback } };
  }

  private completeSuggestionRoute(prompt: string, model: SuggestionModel) {
    return this.deps.gateway.completeStructured<object>(prompt, SUGGESTION_SCHEMA, {
      model: SUGGESTION_MODELS[model],
      maxTokens: 1200,
      timeoutMs: model === "opus" ? 9_000 : 11_000,
      ...(model === "opus" ? { effort: "low" as const } : {}),
    });
  }

  private routeCooldowns(): Partial<Record<SuggestionModel, number>> {
    try {
      const raw = this.deps.db.getAiMeta("suggestion_route_cooldowns_v1");
      return raw ? JSON.parse(raw) as Partial<Record<SuggestionModel, number>> : {};
    } catch {
      return {};
    }
  }

  private setRouteCooldown(model: SuggestionModel, retryAfterMs: number | null): void {
    const duration = retryAfterMs === null
      ? 15 * 60_000
      : Math.min(Math.max(retryAfterMs, 0), 6 * 60 * 60_000);
    this.deps.db.setAiMeta(
      "suggestion_route_cooldowns_v1",
      JSON.stringify({ ...this.routeCooldowns(), [model]: Date.now() + duration }),
    );
  }

  recordSuggestionFeedback(conversationId: ConversationId, request: SuggestionFeedbackRequest, clientKey?: string): Result<true> {
    if (request.suggestion.kind !== "text") return { ok: false, error: "reaction feedback is recorded at send" };
    if (!hasFeedbackLineage(request.suggestion.text, request.finalText)) {
      return { ok: false, error: "suggestion attribution was abandoned" };
    }
    this.recordFeedback({
      id: clientKey ? `command-${clientKey}` : newId(),
      conversation_id: conversationId,
      suggestion_id: request.suggestion.id,
      kind: request.suggestion.kind,
      strategy: request.suggestion.strategy,
      vibe: request.suggestion.vibe,
      selected_model: request.selectedModel,
      served_model: request.servedModel,
      recipe_version: request.recipeVersion,
      suggested_text: request.suggestion.text,
      final_text: request.finalText,
      selected_at: request.selectedAt,
      sent_at: Date.now(),
    });
    return { ok: true, value: true };
  }

  recordReactionFeedback(
    conversationId: ConversationId,
    request: Omit<SuggestionFeedbackRequest, "finalText">,
    clientKey?: string,
  ): void {
    this.recordFeedback({
      id: clientKey ? `command-${clientKey}` : newId(),
      conversation_id: conversationId,
      suggestion_id: request.suggestion.id,
      kind: request.suggestion.kind,
      strategy: request.suggestion.strategy,
      vibe: request.suggestion.vibe,
      selected_model: request.selectedModel,
      served_model: request.servedModel,
      recipe_version: request.recipeVersion,
      suggested_text: request.suggestion.text,
      final_text: request.suggestion.text,
      selected_at: request.selectedAt,
      sent_at: Date.now(),
    });
  }

  private recordFeedback(row: SuggestionFeedbackRow): void {
    try {
      this.deps.db.addSuggestionFeedback(row);
    } catch (error) {
      // The SQLite primary key fences a replay even after a bridge restart.
      if (!(error instanceof Error) || !error.message.includes("UNIQUE constraint failed: suggestion_feedback.id")) throw error;
    }
  }

  clearSuggestionLearning(clientKey?: string): void {
    if (clientKey && this.deps.db.getAiMeta("suggestion_learning_clear_command") === clientKey) return;
    this.learningEpoch++;
    this.deps.db.clearSuggestionLearning();
    if (clientKey) this.deps.db.setAiMeta("suggestion_learning_clear_command", clientKey);
  }

  private async completeJsonLimited<T>(
    prompt: string,
    options: { maxTokens?: number } = {},
  ): Promise<Result<T>> {
    if (this.aiActive >= this.aiConcurrency) {
      await new Promise<void>((resolve) => this.aiWaiters.push(resolve));
    }
    this.aiActive++;
    try {
      return await this.deps.gateway.completeJson<T>(prompt, options);
    } finally {
      this.aiActive--;
      this.aiWaiters.shift()?.();
    }
  }

  /** Who the conversation's first participant is, from the thread, the name Convex knows and the vault. */
  async identify(conversationId: ConversationId): Promise<Result<ContactSuggestion>> {
    const thread = await this.deps.fetchThread(conversationId);
    if (!thread.ok) return thread;
    const participant = thread.value.participants[0];
    if (!participant) return { ok: false, error: "no participant address" };
    const { address } = participant;
    const vault = await vaultCandidates(address, { search: this.deps.searchVault });
    const candidates = mergeCandidates([contactCandidate(participant.name), vault]);
    const transcript = renderTranscript(thread.value.messages, { limit: 25 });
    return this.completeJsonLimited<ContactSuggestion>(
      identifyPrompt(address, transcript, candidates),
      { maxTokens: 400 },
    );
  }
}

function emptySuggestions(selectedModel: SuggestionModel, currentGuid: string): ReplySuggestions {
  return {
    suggestions: [],
    event: null,
    recipeVersion: SUGGESTION_RECIPE_VERSION,
    selectedModel,
    servedModel: selectedModel,
    fallback: false,
    noReply: true,
    basedOnMessageGuid: currentGuid,
    stale: false,
    generatedAt: Date.now(),
  };
}

function otherModel(model: SuggestionModel): SuggestionModel {
  return model === "opus" ? "terra" : "opus";
}

function hasFeedbackLineage(suggested: string, finalText: string): boolean {
  const source = new Set(normalizedWords(suggested));
  const final = normalizedWords(finalText);
  if (source.size === 0 || final.length === 0) return false;
  const shared = final.filter((word) => source.has(word)).length;
  return shared / Math.max(source.size, final.length) >= 0.15;
}

function normalizedWords(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
}

function newId(): string {
  return `sh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export { Gateway };
