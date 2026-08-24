import type { Result } from "../bluebubbles";
import type { AiConfig } from "../config";
import type { OverlayDb } from "../db";
import type {
  ContactSuggestion,
  Message,
  ReplySuggestions,
  ShadowBrief,
  SmartCloser,
  SuggestionFeedbackRequest,
  SuggestionModel,
} from "../../shared/types";
import { loadProfile, renderSuggestionContext, renderTranscript } from "./context";
import { Gateway, type GatewayFailure } from "./gateway";
import { contactCandidate, mergeCandidates, vaultCandidates } from "./identify";
import { groupNamePrompt, identifyPrompt, shadowBriefPrompt, smartCloserPrompt } from "./prompts";
import { ShadowRunner, type ShadowAvailability } from "./shadow";
import { deterministicSmartCloser, parseSmartCloser, parseSmartCloserJson, type JsonValue } from "./smart-closer";
import { parseShadowBriefContent, parseShadowBriefJson } from "./shadow-brief";
import {
  SUGGESTION_MODELS,
  SUGGESTION_RECIPE_VERSION,
  SUGGESTION_SCHEMA,
  suggestionPrompt,
  suggestionTargetGuids,
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
  shadow: ShadowRunner;
  /**
   * Startup probe of the harness lane, injected by index.ts. The shelf and
   * the shadow panel both ride that lane, so both surfaces gate on it.
   */
  shadowStatus?: ShadowAvailability;
  /** Newest-last messages for a chat; read errors must remain distinguishable from an empty chat. */
  fetchMessages: (chatGuid: string) => Promise<Result<Message[]>>;
  /** One message enriched with current tapbacks for reaction validation. */
  fetchMessageWithReactions: (chatGuid: string, messageGuid: string) => Promise<Result<Message>>;
  /** Recent global outbound text, reduced locally into aggregate style. */
  recentOutboundText: () => string[];
  /** BlueBubbles Private API supports outbound tapbacks. */
  reactionSuggestions: () => boolean;
  /** Vault grep, injected so tests never touch the filesystem. */
  searchVault: (pattern: string) => Promise<Array<{ path: string; line: string }>>;
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
      !Array.isArray(parsed.suggestions)
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

export class AiService {
  /** Per-chat serialization of shadow turns; also the "is a turn pending" set. */
  private shadowQueues = new Map<string, Promise<void>>();
  private suggestionInFlight = new Map<string, Promise<Result<ReplySuggestions>>>();
  private structuredInFlight = new Map<string, Promise<SmartCloser | ShadowBrief>>();
  private aiActive = 0;
  private aiWaiters: Array<() => void> = [];
  private readonly aiConcurrency = 2;

  constructor(private deps: AiDeps) {}

  get available(): boolean {
    return this.deps.gateway.available;
  }

  /** Whether the harness lane (ccs delegate) can run for the shadow panel. */
  get shadowAvailable(): boolean {
    return this.deps.shadowStatus?.available ?? false;
  }

  async groupNames(chatGuid: string, participants: string[]): Promise<Result<string[]>> {
    const messages = await this.deps.fetchMessages(chatGuid);
    if (!messages.ok) return messages;
    const transcript = renderTranscript(messages.value, { limit: 30 });
    return this.completeJsonLimited<string[]>(groupNamePrompt(transcript, participants), {
      maxTokens: 300,
    });
  }

  /** Returns the selected route's cached shelf unless it is missing, or `force` is set. */
  async replySuggestions(
    chatGuid: string,
    peerName: string | null,
    force: boolean,
    selectedModel: SuggestionModel,
  ): Promise<Result<ReplySuggestions>> {
    const fetched = await this.deps.fetchMessages(chatGuid);
    if (!fetched.ok) return fetched;
    const messages = fetched.value;
    const currentGuid = lastGuid(messages);
    if (!currentGuid) return { ok: false, error: "chat has no messages" };
    if (messages[messages.length - 1]?.isFromMe) {
      return {
        ok: true,
        value: emptySuggestions(selectedModel, currentGuid),
      };
    }
    const voice = loadVoiceState(this.deps.db, this.deps.recentOutboundText());
    const cached = this.deps.db.getSuggestionCache(chatGuid, selectedModel);

    if (
      cached &&
      !force &&
      cached.anchor_guid === currentGuid &&
      cached.recipe_version === SUGGESTION_RECIPE_VERSION &&
      cached.voice_revision === voice.voiceRevision &&
      cached.edit_revision === voice.editRevision
    ) {
      const parsed = parseSuggestionCache(cached.payload);
      if (parsed) {
        return {
          ok: true,
          value: {
            ...parsed,
            basedOnMessageGuid: cached.anchor_guid,
            stale: isStale(cached.anchor_guid, currentGuid),
            generatedAt: cached.created_at,
          },
        };
      }
    }

    const key = [
      chatGuid,
      currentGuid,
      selectedModel,
      SUGGESTION_RECIPE_VERSION,
      voice.voiceRevision,
      voice.editRevision,
    ].join(":");
    const existing = this.suggestionInFlight.get(key);
    if (existing) return existing;
    const pending = this.generateReplySuggestions(
      chatGuid,
      peerName,
      messages,
      currentGuid,
      selectedModel,
      voice,
    );
    this.suggestionInFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.suggestionInFlight.get(key) === pending) this.suggestionInFlight.delete(key);
    }
  }

  private async generateReplySuggestions(
    chatGuid: string,
    peerName: string | null,
    messages: Message[],
    currentGuid: string,
    selectedModel: SuggestionModel,
    voice: ReturnType<typeof loadVoiceState>,
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
    });
    const generated = await this.completeSuggestionWithFallback(prompt, selectedModel);
    if (!generated.ok) return { ok: false, error: generated.error.message };

    const enriched = [...messages];
    const verifiedReactionGuids = new Set<string>();
    for (const targetGuid of suggestionTargetGuids(generated.value.value)) {
      const reactionMessage = await this.deps.fetchMessageWithReactions(chatGuid, targetGuid);
      if (!reactionMessage.ok) continue;
      const index = enriched.findIndex((message) => message.guid === targetGuid);
      if (index >= 0) enriched[index] = reactionMessage.value;
      verifiedReactionGuids.add(targetGuid);
    }
    const validated = validateSuggestionSet(generated.value.value, {
      messages: enriched,
      renderedGuids: context.renderedGuids,
      reactionSuggestions: this.deps.reactionSuggestions(),
      verifiedReactionGuids,
    });
    if (!validated.ok) return validated;

    const payload: SuggestionCachePayload = {
      recipeVersion: SUGGESTION_RECIPE_VERSION,
      selectedModel,
      servedModel: generated.value.servedModel,
      fallback: generated.value.servedModel !== selectedModel,
      noReply: validated.value.noReply,
      suggestions: validated.value.suggestions,
    };
    this.deps.db.setSuggestionCache({
      chat_guid: chatGuid,
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
        stale: false,
        generatedAt: Date.now(),
      },
    };
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

  recordSuggestionFeedback(chatGuid: string, request: SuggestionFeedbackRequest): Result<true> {
    if (request.suggestion.kind !== "text") return { ok: false, error: "reaction feedback is recorded at send" };
    if (!hasFeedbackLineage(request.suggestion.text, request.finalText)) {
      return { ok: false, error: "suggestion attribution was abandoned" };
    }
    this.deps.db.addSuggestionFeedback({
      id: newId(),
      chat_guid: chatGuid,
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
    chatGuid: string,
    request: Omit<SuggestionFeedbackRequest, "finalText">,
  ): void {
    this.deps.db.addSuggestionFeedback({
      id: newId(),
      chat_guid: chatGuid,
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

  clearSuggestionLearning(): void {
    this.deps.db.clearSuggestionLearning();
  }

  async smartCloser(chatGuid: string): Promise<Result<SmartCloser>> {
    const fetched = await this.deps.fetchMessages(chatGuid);
    if (!fetched.ok) return fetched;
    const messages = fetched.value;
    const inbound = [...messages].reverse().find((message) => !message.isFromMe);
    if (!inbound) return { ok: true, value: { kind: "done", label: "Done" } };

    const cached = this.deps.db.getSmartCloserCache(chatGuid);
    if (cached?.inbound_message_guid === inbound.guid) {
      const parsed = parseSmartCloserJson(cached.payload);
      if (parsed.ok) return parsed;
    }

    const key = `closer:${chatGuid}:${inbound.guid}`;
    const existing = this.structuredInFlight.get(key);
    if (existing) return { ok: true, value: (await existing) as SmartCloser };
    const pending = this.generateSmartCloser(chatGuid, inbound.guid, inbound.text, messages);
    this.structuredInFlight.set(key, pending);
    try {
      return { ok: true, value: await pending };
    } finally {
      if (this.structuredInFlight.get(key) === pending) this.structuredInFlight.delete(key);
    }
  }

  private async generateSmartCloser(
    chatGuid: string,
    inboundGuid: string,
    inboundText: string,
    messages: Message[],
  ): Promise<SmartCloser> {
    let closer = deterministicSmartCloser(inboundText);
    if (this.available) {
      const generated = await this.completeJsonLimited<JsonValue>(
        smartCloserPrompt(renderTranscript(messages, { limit: 30 })),
        { maxTokens: 240 },
      );
      if (generated.ok) {
        const parsed = parseSmartCloser(generated.value);
        if (parsed.ok) closer = parsed.value;
      }
    }
    this.deps.db.setSmartCloserCache(chatGuid, inboundGuid, JSON.stringify(closer));
    return closer;
  }

  async shadowBrief(chatGuid: string, force: boolean): Promise<Result<ShadowBrief>> {
    const fetched = await this.deps.fetchMessages(chatGuid);
    if (!fetched.ok) return fetched;
    const messages = fetched.value;
    const messageGuid = lastGuid(messages);
    if (!messageGuid) return { ok: false, error: "chat has no messages" };
    const cached = this.deps.db.getShadowBriefCache(chatGuid);
    if (!force && cached?.message_guid === messageGuid) {
      const parsed = parseShadowBriefJson(cached.payload);
      if (parsed.ok) return { ok: true, value: { ...parsed.value, basedOnMessageGuid: messageGuid } };
    }

    const key = `brief:${chatGuid}:${messageGuid}`;
    const existing = this.structuredInFlight.get(key);
    if (existing) return { ok: true, value: (await existing) as ShadowBrief };
    const pending = this.generateShadowBrief(chatGuid, messageGuid, messages);
    this.structuredInFlight.set(key, pending);
    try {
      return { ok: true, value: await pending };
    } finally {
      if (this.structuredInFlight.get(key) === pending) this.structuredInFlight.delete(key);
    }
  }

  private async generateShadowBrief(
    chatGuid: string,
    messageGuid: string,
    messages: Message[],
  ): Promise<ShadowBrief> {
    let content: Omit<ShadowBrief, "basedOnMessageGuid"> = { context: "", actionItems: [], draft: "" };
    if (this.available) {
      const generated = await this.completeJsonLimited<JsonValue>(
        shadowBriefPrompt(renderTranscript(messages, { limit: 50 })),
        { maxTokens: 700 },
      );
      if (generated.ok) {
        const parsed = parseShadowBriefContent(generated.value);
        if (parsed.ok) content = parsed.value;
      }
    }
    this.deps.db.setShadowBriefCache(chatGuid, messageGuid, JSON.stringify(content));
    return { ...content, basedOnMessageGuid: messageGuid };
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

  async identify(
    chatGuid: string,
    address: string,
    knownName: string | null,
  ): Promise<Result<ContactSuggestion>> {
    const [messages, vault] = await Promise.all([
      this.deps.fetchMessages(chatGuid),
      vaultCandidates(address, { search: this.deps.searchVault }),
    ]);
    if (!messages.ok) return messages;
    const candidates = mergeCandidates([contactCandidate(knownName), vault]);
    const transcript = renderTranscript(messages.value, { limit: 25 });
    return this.completeJsonLimited<ContactSuggestion>(
      identifyPrompt(address, transcript, candidates),
      { maxTokens: 400 },
    );
  }

  /**
   * Fire a shadow turn without making the caller wait for it. Milad's message
   * is persisted now; the reply (or a visible error) is persisted when the
   * delegate finishes — so the result survives closing the panel or moving to
   * another conversation. Turns for one chat are serialized so a double-send
   * cannot run two delegates against the same anchor at once.
   *
   * Returns the background completion promise, which the route ignores and
   * tests can await.
   */
  shadowEnqueue(chatGuid: string, text: string, peerName: string | null): Promise<void> {
    this.deps.db.addShadowMessage(newId(), chatGuid, "user", text);
    const prior = this.shadowQueues.get(chatGuid) ?? Promise.resolve();
    const next = prior
      .catch(() => undefined)
      .then(() => this.runShadowTurn(chatGuid, peerName));
    this.shadowQueues.set(chatGuid, next);
    void next.finally(() => {
      if (this.shadowQueues.get(chatGuid) === next) this.shadowQueues.delete(chatGuid);
    });
    return next;
  }

  /** True while a turn for this chat is running or queued. */
  shadowPending(chatGuid: string): boolean {
    return this.shadowQueues.has(chatGuid);
  }

  private async runShadowTurn(chatGuid: string, peerName: string | null): Promise<void> {
    const [messages, profile] = await Promise.all([
      this.deps.fetchMessages(chatGuid),
      loadProfile(this.deps.config.vaultPath),
    ]);
    if (!messages.ok) {
      this.deps.db.addShadowMessage(newId(), chatGuid, "assistant", `⚠️ ${messages.error}`);
      return;
    }
    const history = this.deps.db
      .listShadowMessages(chatGuid)
      .map((row) => `${row.role === "user" ? "Milad" : "You"}: ${row.text}`)
      .join("\n");

    const prompt = [
      "You are Milad's assistant, sitting alongside an iMessage conversation he has open.",
      "You have full tool access. When he asks you to do something, do it.",
      "Answer briefly and concretely.",
      "",
      profile ? `About Milad:\n${profile}\n` : "",
      `The iMessage conversation${peerName ? ` with ${peerName}` : ""}:`,
      renderTranscript(messages.value, { limit: 40, peerName }),
      "",
      "Your conversation with Milad so far:",
      history,
    ]
      .filter(Boolean)
      .join("\n");

    const reply = await this.deps.shadow.turn(prompt);
    // Persist something either way — a silent failure would strand the user's
    // message with no reply, which is the one outcome we must never produce.
    const text = reply.ok ? reply.value : `⚠️ ${reply.error}`;
    this.deps.db.addShadowMessage(newId(), chatGuid, "assistant", text);
  }
}

function emptySuggestions(selectedModel: SuggestionModel, currentGuid: string): ReplySuggestions {
  return {
    suggestions: [],
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

export { Gateway, ShadowRunner };
