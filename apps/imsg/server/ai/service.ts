import type { Result } from "../bluebubbles";
import type { AiConfig } from "../config";
import type { OverlayDb } from "../db";
import type { ContactSuggestion, Message, ReplySuggestions, ShadowBrief, SmartCloser } from "../../shared/types";
import { loadProfile, renderTranscript } from "./context";
import { Gateway } from "./gateway";
import { contactCandidate, mergeCandidates, vaultCandidates } from "./identify";
import { groupNamePrompt, identifyPrompt, replySuggestionPrompt, shadowBriefPrompt, smartCloserPrompt } from "./prompts";
import { ShadowRunner, type ShadowAvailability } from "./shadow";
import { deterministicSmartCloser, parseSmartCloser, parseSmartCloserJson, type JsonValue } from "./smart-closer";
import { parseShadowBriefContent, parseShadowBriefJson } from "./shadow-brief";

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
  /** Newest-last messages for a chat. */
  fetchMessages: (chatGuid: string) => Promise<Message[]>;
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

  /**
   * Whether the harness lane (ccs delegate) can run. The shelf rides it too,
   * so the client gates both surfaces on this rather than the gateway key.
   */
  get shadowAvailable(): boolean {
    return this.deps.shadowStatus?.available ?? false;
  }

  async groupNames(chatGuid: string, participants: string[]): Promise<Result<string[]>> {
    const messages = await this.deps.fetchMessages(chatGuid);
    const transcript = renderTranscript(messages, { limit: 30 });
    return this.completeJsonLimited<string[]>(groupNamePrompt(transcript, participants), {
      maxTokens: 300,
    });
  }

  /** Returns the cached shelf unless it is missing, or `force` is set. */
  async replySuggestions(
    chatGuid: string,
    peerName: string | null,
    force: boolean,
  ): Promise<Result<ReplySuggestions>> {
    const messages = await this.deps.fetchMessages(chatGuid);
    const currentGuid = lastGuid(messages);
    const cached = this.deps.db.getSuggestionCache(chatGuid);

    if (cached && !force) {
      return {
        ok: true,
        value: {
          suggestions: safeParse(cached.payload),
          basedOnMessageGuid: cached.last_message_guid,
          stale: isStale(cached.last_message_guid, currentGuid),
          generatedAt: cached.created_at,
        },
      };
    }

    const key = `${chatGuid}:${currentGuid ?? "empty"}`;
    const existing = this.suggestionInFlight.get(key);
    if (existing) return existing;
    const pending = this.generateReplySuggestions(chatGuid, peerName, messages, currentGuid);
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
    currentGuid: string | null,
  ): Promise<Result<ReplySuggestions>> {
    const profile = await loadProfile(this.deps.config.vaultPath);
    const transcript = renderTranscript(messages, { limit: 40, peerName });
    const generated = await this.shadowTurnLimited(replySuggestionPrompt(transcript, profile, peerName));
    if (!generated.ok) return generated;

    const parsed = parseSuggestionArray(generated.value);
    if (!parsed.ok) return parsed;
    this.deps.db.setSuggestionCache(chatGuid, currentGuid, JSON.stringify(parsed.value));
    return {
      ok: true,
      value: { suggestions: parsed.value, basedOnMessageGuid: currentGuid, stale: false, generatedAt: Date.now() },
    };
  }

  private async shadowTurnLimited(prompt: string): Promise<Result<string>> {
    if (this.aiActive >= this.aiConcurrency) {
      await new Promise<void>((resolve) => this.aiWaiters.push(resolve));
    }
    this.aiActive++;
    try {
      return await this.deps.shadow.turn(prompt);
    } finally {
      this.aiActive--;
      this.aiWaiters.shift()?.();
    }
  }

  async smartCloser(chatGuid: string): Promise<Result<SmartCloser>> {
    const messages = await this.deps.fetchMessages(chatGuid);
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
    const messages = await this.deps.fetchMessages(chatGuid);
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
    const candidates = mergeCandidates([contactCandidate(knownName), vault]);
    const transcript = renderTranscript(messages, { limit: 25 });
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
      renderTranscript(messages, { limit: 40, peerName }),
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

/**
 * The harness lane returns prose, not a guaranteed JSON document. Models wrap
 * arrays in code fences or narrate around them, so find the array instead of
 * demanding the whole reply be one.
 */
export function parseSuggestionArray(reply: string): Result<string[]> {
  // Prefer a fenced ```json block when present; otherwise the first [...] run.
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], reply].filter((text): text is string => typeof text === "string");
  for (const candidate of candidates) {
    const start = candidate.indexOf("[");
    const end = candidate.lastIndexOf("]");
    if (start === -1 || end <= start) continue;
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1)) as JsonValue;
      if (!Array.isArray(parsed)) continue;
      const strings = parsed.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0,
      );
      if (strings.length > 0) return { ok: true, value: strings.slice(0, 3) };
    } catch {
      // fall through to the next candidate
    }
  }
  return { ok: false, error: "no suggestion array in harness reply" };
}

function safeParse(payload: string): string[] {
  try {
    const parsed = JSON.parse(payload) as JsonValue;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function newId(): string {
  return `sh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export { Gateway, ShadowRunner };
