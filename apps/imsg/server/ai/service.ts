import type { Result } from "../bluebubbles";
import type { AiConfig } from "../config";
import type { OverlayDb } from "../db";
import type { ContactSuggestion, Message, ReplySuggestions } from "../../shared/types";
import { loadProfile, renderTranscript } from "./context";
import { Gateway } from "./gateway";
import { contactCandidate, mergeCandidates, vaultCandidates } from "./identify";
import { groupNamePrompt, identifyPrompt, replySuggestionPrompt } from "./prompts";
import { ShadowRunner } from "./shadow";

/**
 * Orchestration for both AI lanes. Everything the routes need lives here so
 * `index.ts` stays a routing table.
 */

export interface AiDeps {
  config: AiConfig;
  db: OverlayDb;
  gateway: Gateway;
  shadow: ShadowRunner;
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
  constructor(private deps: AiDeps) {}

  get available(): boolean {
    return this.deps.gateway.available;
  }

  async groupNames(chatGuid: string, participants: string[]): Promise<Result<string[]>> {
    const messages = await this.deps.fetchMessages(chatGuid);
    const transcript = renderTranscript(messages, { limit: 30 });
    return this.deps.gateway.completeJson<string[]>(groupNamePrompt(transcript, participants), {
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

    const profile = await loadProfile(this.deps.config.vaultPath);
    const transcript = renderTranscript(messages, { limit: 40, peerName });
    const generated = await this.deps.gateway.completeJson<string[]>(
      replySuggestionPrompt(transcript, profile, peerName),
      { maxTokens: 600 },
    );
    if (!generated.ok) return generated;

    const suggestions = generated.value.filter((s) => typeof s === "string" && s.trim()).slice(0, 3);
    this.deps.db.setSuggestionCache(chatGuid, currentGuid, JSON.stringify(suggestions));
    return {
      ok: true,
      value: { suggestions, basedOnMessageGuid: currentGuid, stale: false, generatedAt: Date.now() },
    };
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
    return this.deps.gateway.completeJson<ContactSuggestion>(
      identifyPrompt(address, transcript, candidates),
      { maxTokens: 400 },
    );
  }

  /**
   * One shadow turn: persist Milad's message, replay the whole shadow thread
   * alongside the iMessage transcript, then persist the reply.
   */
  async shadowTurn(chatGuid: string, text: string, peerName: string | null): Promise<Result<string>> {
    this.deps.db.addShadowMessage(newId(), chatGuid, "user", text);

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
    if (!reply.ok) return reply;
    this.deps.db.addShadowMessage(newId(), chatGuid, "assistant", reply.value);
    return reply;
  }
}

function safeParse(payload: string): string[] {
  try {
    const parsed = JSON.parse(payload) as unknown;
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function newId(): string {
  return `sh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export { Gateway, ShadowRunner };
