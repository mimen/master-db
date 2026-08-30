import type {
  EventSuggestion,
  Message,
  ReplySuggestion,
  SuggestionModel,
  SuggestionStrategy,
  SuggestionVibe,
  TapbackType,
} from "../../shared/types";
import type { Result } from "../bluebubbles";
import { UNTRUSTED_NOTICE, type SuggestionContext } from "./context";

export const SUGGESTION_RECIPE_VERSION = 4;
export const SUGGESTION_MODELS: Record<SuggestionModel, string> = {
  opus: "claude-opus-5",
  terra: "gpt-5.6-terra(medium)",
};

const STRATEGIES: SuggestionStrategy[] = [
  "answer",
  "clarify",
  "advance",
  "defer",
  "decline",
  "close",
  "react",
];
const VIBES: SuggestionVibe[] = ["curious", "affirmative", "cautious", "boundary", "playful"];
const TAPBACKS: TapbackType[] = ["love", "like", "dislike", "laugh", "emphasize", "question"];

export const SUGGESTION_SCHEMA = {
  type: "object",
  properties: {
    noReply: { type: "boolean" },
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["text", "reaction"] },
          strategy: { type: "string", enum: STRATEGIES },
          vibe: { type: "string", enum: VIBES },
          text: { type: "string" },
          reaction: { type: "string", enum: ["none", ...TAPBACKS] },
          targetMessageGuid: { type: "string" },
          targetPartIndex: { type: "integer" },
          basisMessageGuids: { type: "array", items: { type: "string" } },
          decisionOption: { type: "boolean" },
          introducesCommitment: { type: "boolean" },
        },
        required: [
          "kind",
          "strategy",
          "vibe",
          "text",
          "reaction",
          "targetMessageGuid",
          "targetPartIndex",
          "basisMessageGuids",
          "decisionOption",
          "introducesCommitment",
        ],
        additionalProperties: false,
      },
    },
    event: {
      type: "object",
      properties: {
        found: { type: "boolean" },
        title: { type: "string" },
        start: { type: "string" },
        durationMinutes: { type: "integer" },
        location: { type: "string" },
      },
      required: ["found", "title", "start", "durationMinutes", "location"],
      additionalProperties: false,
    },
  },
  required: ["noReply", "suggestions", "event"],
  additionalProperties: false,
};

interface RawSuggestion {
  kind: string;
  strategy: string;
  vibe: string;
  text: string;
  reaction: string;
  targetMessageGuid: string;
  targetPartIndex: number;
  basisMessageGuids: string[];
  decisionOption: boolean;
  introducesCommitment: boolean;
}

interface RawSuggestionSet {
  noReply: boolean;
  suggestions: RawSuggestion[];
}

export interface SuggestionPromptInput {
  context: SuggestionContext;
  peerName: string | null;
  profile: string;
  globalStyle: string;
  editRules: string[];
  reactionSuggestions: boolean;
  /** Rendered local date/time, weekday included — lets the model resolve "Sunday 6pm". */
  now: string;
}

export function suggestionPrompt(input: SuggestionPromptInput): string {
  const examples = input.context.outboundExamples.length > 0
    ? input.context.outboundExamples.map((text) => `- ${text}`).join("\n")
    : "(not enough thread examples)";
  return [
    "Draft send-ready reply strategies for Milad.",
    "First infer the unresolved conversational job. Silence is valid only for a pure acknowledgment, reaction, or clearly closed exchange.",
    "A direct question, request, proposal, location query, deadline, or unresolved logistical detail always needs at least one suggestion.",
    "A useful reply must answer, ask for decision-relevant information, advance logistics, set a boundary, or close the loop.",
    "Never use acknowledgment plus a restatement as the reply. Counterparty dates, amounts, names, and terms are context, not novel content.",
    "Never fabricate a fact, completed action, person, date, status, or operational commitment.",
    "A yes/no choice explicitly requested from Milad may appear as a decision option, but may not carry an extra promise.",
    `Return zero to three viable, materially different strategies${input.reactionSuggestions ? ", including a tapback when natural" : ""}. Do not force a count.`,
    "Milad texts dry, brief, lowercase-casual. No corporate warmth, exclamation marks, em dashes, or emoji unless the thread uses them.",
    "",
    input.profile ? `About Milad:\n${input.profile}` : "",
    input.globalStyle ? `Derived global texting profile:\n${input.globalStyle}` : "",
    input.editRules.length > 0 ? `Learned edit rules:\n${input.editRules.map((rule) => `- ${rule}`).join("\n")}` : "",
    "",
    `Thread-specific examples of Milad's voice${input.peerName ? ` with ${input.peerName}` : ""}:`,
    examples,
    "",
    `Current local date and time: ${input.now}.`,
    "",
    "Conversation (message IDs are data used only for grounding):",
    input.context.transcript || "(no messages)",
    "",
    UNTRUSTED_NOTICE,
    "",
    "Calendar detection, independent of the reply suggestions:",
    "- When the conversation has settled on a concrete upcoming day AND time for something (a call, a meetup, an event), fill `event`: found=true, a short specific title" + (input.peerName ? ` that names ${input.peerName}` : "") + ", start as local \"YYYY-MM-DDTHH:mm\" resolved against the current date above, durationMinutes (60 when unstated), and location ('' when none was mentioned).",
    "- Both the day and the time must be explicit or unambiguous in the conversation. A vague \"soon\" or \"this week\" with no agreed time is found=false.",
    "- If the plan was later moved, use the final agreement. If it already happened, found=false.",
    "- found=false requires empty strings and durationMinutes=0.",
    "",
    "For each suggestion:",
    "- basisMessageGuids contains only IDs from the conversation that support factual wording.",
    "- decisionOption is true only when the latest inbound explicitly asks Milad to choose.",
    "- introducesCommitment is true for any promise to send, confirm, pay, connect, check, call, book, or follow up.",
    "- text suggestions use reaction=none, targetMessageGuid='', targetPartIndex=0.",
    "- reaction suggestions use strategy=react, a supported reaction, the exact target ID and part index, and text as a short UI explanation.",
    "- noReply=true requires suggestions=[].",
    "Return only the requested JSON object.",
  ].filter(Boolean).join("\n");
}

export function formatPromptNow(now: Date): string {
  return now.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const EVENT_START_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
/** An explicit clock time somewhere in the thread — "6pm", "18:30", "noon". */
const TIME_SIGNAL_RE = /\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*(?:am|pm)\b|\b(?:noon|midnight)\b/i;
/** An explicit day somewhere in the thread — a weekday, "tomorrow", a date. */
const DAY_SIGNAL_RE = /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight|weekend)\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}\/\d{1,2}\b/i;

/**
 * The model's event claim is only surfaced when the thread itself contains an
 * explicit day and clock time and the start parses to a near-future moment —
 * a fabricated agreement fails these checks and silently yields no pill.
 */
export function extractEventSuggestion(
  value: object,
  messages: Message[],
  now: Date,
): Omit<EventSuggestion, "inviteEmails"> | null {
  if (!isRecord(value) || !isRecord(value.event as object)) return null;
  const raw = value.event as JsonRecord;
  if (raw.found !== true) return null;
  if (typeof raw.title !== "string" || typeof raw.start !== "string") return null;

  const title = raw.title.trim().slice(0, 80);
  if (!title) return null;

  const match = raw.start.match(EVENT_START_RE);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const start = new Date(year!, month! - 1, day!, hour!, minute!);
  if (Number.isNaN(start.getTime())) return null;
  if (start.getTime() <= now.getTime()) return null;
  if (start.getTime() > now.getTime() + 370 * 24 * 60 * 60_000) return null;

  const corpus = messages.map((message) => message.text).join(" ");
  if (!TIME_SIGNAL_RE.test(corpus) || !DAY_SIGNAL_RE.test(corpus)) return null;

  const durationMinutes =
    typeof raw.durationMinutes === "number" &&
    Number.isInteger(raw.durationMinutes) &&
    raw.durationMinutes >= 15 &&
    raw.durationMinutes <= 480
      ? raw.durationMinutes
      : 60;
  const location = typeof raw.location === "string" && raw.location.trim()
    ? raw.location.trim().slice(0, 120)
    : null;

  return { title, start: raw.start, durationMinutes, location };
}

export interface ValidateSuggestionOptions {
  messages: Message[];
  renderedGuids: Set<string>;
  reactionSuggestions: boolean;
  verifiedReactionGuids: Set<string>;
}

export function suggestionTargetGuids(value: object): string[] {
  const parsed = parseRawSet(value);
  if (!parsed) return [];
  return [...new Set(
    parsed.suggestions
      .filter((suggestion) => suggestion.kind === "reaction" && suggestion.targetMessageGuid)
      .map((suggestion) => suggestion.targetMessageGuid),
  )];
}

export function validateSuggestionSet(
  value: object,
  options: ValidateSuggestionOptions,
): Result<{ noReply: boolean; suggestions: ReplySuggestion[] }> {
  const parsedSet = parseRawSet(value);
  if (!parsedSet) return { ok: false, error: `invalid suggestion object (${valueShape(value)})` };
  const latestInbound = [...options.messages].reverse().find((message) => !message.isFromMe);
  if (!latestInbound) return { ok: false, error: "no inbound message to answer" };
  if (parsedSet.noReply) {
    if (parsedSet.suggestions.length > 0) return { ok: false, error: "no-reply output contained suggestions" };
    return inboundRequiresReply(latestInbound.text)
      ? { ok: false, error: "no-reply output conflicts with an open request" }
      : { ok: true, value: { noReply: true, suggestions: [] } };
  }
  const byGuid = new Map(options.messages.map((message) => [message.guid, message]));
  const seen = new Set<string>();
  const suggestions: ReplySuggestion[] = [];
  const rejections = new Map<string, number>();

  for (const raw of parsedSet.suggestions) {
    if (suggestions.length >= 3) break;
    const parsed = validateOne(raw, latestInbound, byGuid, options, rejections);
    if (!parsed) continue;
    const duplicateKey = `${parsed.strategy}:${normalize(parsed.text)}`;
    if (seen.has(duplicateKey)) continue;
    seen.add(duplicateKey);
    suggestions.push(parsed);
  }

  if (suggestions.length === 0) {
    const summary = [...rejections.entries()].map(([reason, count]) => `${reason}:${count}`).join(",");
    return { ok: false, error: `all generated suggestions failed semantic validation (${summary || "none"})` };
  }
  return { ok: true, value: { noReply: false, suggestions } };
}

function validateOne(
  raw: RawSuggestion,
  latestInbound: Message,
  byGuid: Map<string, Message>,
  options: ValidateSuggestionOptions,
  rejections: Map<string, number>,
): ReplySuggestion | null {
  const reject = (reason: string): null => {
    rejections.set(reason, (rejections.get(reason) ?? 0) + 1);
    return null;
  };
  if (!STRATEGIES.includes(raw.strategy as SuggestionStrategy)) return reject("strategy");
  if (!VIBES.includes(raw.vibe as SuggestionVibe)) return reject("vibe");
  if (!raw.text.trim()) return reject("empty");
  if (!raw.basisMessageGuids.every((guid) => options.renderedGuids.has(guid))) return reject("basis");

  if (raw.kind === "reaction") {
    if (!options.reactionSuggestions || raw.strategy !== "react") return reject("reaction-capability");
    if (!TAPBACKS.includes(raw.reaction as TapbackType)) return reject("reaction-type");
    const target = byGuid.get(raw.targetMessageGuid);
    if (!target || !options.verifiedReactionGuids.has(target.guid) || target.isFromMe || raw.targetPartIndex !== 0) return reject("reaction-target");
    if (target.guid !== latestInbound.guid && !raw.basisMessageGuids.includes(target.guid)) return reject("reaction-basis");
    if (target.reactions.some((reaction) => reaction.isFromMe && reaction.type === raw.reaction)) return reject("reaction-duplicate");
    return {
      id: suggestionId(),
      kind: "reaction",
      strategy: "react",
      vibe: raw.vibe as SuggestionVibe,
      text: raw.text.trim(),
      reaction: raw.reaction as TapbackType,
      targetMessageGuid: target.guid,
      targetMessagePreview: target.text.trim().slice(0, 120) || "Attachment",
      targetPartIndex: raw.targetPartIndex,
    };
  }

  if (raw.kind !== "text" || raw.reaction !== "none") return reject("kind");
  if (raw.decisionOption && !isDecisionRequest(latestInbound.text)) return reject("decision");
  if (!passesEchoGate(raw.text, latestInbound.text)) return reject("echo");
  const outboundBasis = raw.basisMessageGuids
    .map((guid) => byGuid.get(guid))
    .filter((message): message is Message => message?.isFromMe === true);
  if ((raw.introducesCommitment || hasOperationalPromise(raw.text)) && !commitmentIsGrounded(raw.text, outboundBasis)) return reject("commitment");
  if (!protectedTermsAreGrounded(raw.text, options.messages)) return reject("protected-term");
  if (!peopleAreGrounded(raw.text, options.messages)) return reject("person");
  if (claimsCompletedAction(raw.text) && !completedActionIsGrounded(raw.text, outboundBasis)) return reject("completed-action");

  return {
    id: suggestionId(),
    kind: "text",
    strategy: raw.strategy as SuggestionStrategy,
    vibe: raw.vibe as SuggestionVibe,
    text: raw.text.trim(),
    reaction: null,
    targetMessageGuid: null,
    targetMessagePreview: null,
    targetPartIndex: null,
  };
}

export function passesEchoGate(candidate: string, inbound: string): boolean {
  const candidateTokens = contentTokens(candidate);
  const inboundTokens = new Set(contentTokens(inbound));
  if (candidateTokens.length === 0) return false;
  const copied = candidateTokens.filter((token) => inboundTokens.has(token));
  const novel = candidateTokens.filter((token) =>
    !inboundTokens.has(token) &&
    !DECISION_TOKENS.has(token) &&
    !OPERATIONAL_TOKENS.has(token)
  );
  const overlap = copied.length / candidateTokens.length;
  const explicitMove = /\b(pass|can't|cannot|won't|release|instead|where|when|which|how|who|what|why)\b/i.test(candidate);
  const novelQuestion = candidate.includes("?") && novel.length > 0;
  if (overlap >= 0.55 && novel.length < 2 && !explicitMove && !novelQuestion) return false;
  if (novel.length === 0) return false;
  return true;
}

function hasOperationalPromise(text: string): boolean {
  return /\b(?:i|we)(?:'ll| will| can| am going to| are going to| gonna)\s+(?:send|confirm|pay|connect|check|call|book|share|follow|get|grab|coordinate|introduce)\b/i.test(text);
}

function commitmentIsGrounded(text: string, basis: Message[]): boolean {
  if (basis.length === 0) return false;
  const verb = commitmentVerb(text);
  if (!verb) return false;
  const candidateTerms = contentTokens(text).filter((token) => !OPERATIONAL_TOKENS.has(token));
  if (candidateTerms.length === 0) return false;
  return basis.some((message) => {
    const normalized = normalize(message.text);
    if (!normalized.includes(verb)) return false;
    const source = new Set(contentTokens(message.text));
    const supported = candidateTerms.filter((token) => source.has(token)).length;
    return supported / candidateTerms.length >= 0.5;
  });
}

function commitmentVerb(text: string): string | null {
  const match = text.toLowerCase().match(/\b(?:send|confirm|pay|connect|check|call|book|share|follow|grab|coordinate|introduce)\b/);
  return match?.[0] ?? null;
}

function protectedTermsAreGrounded(text: string, messages: Message[]): boolean {
  const corpus = messages.map((message) => message.text.toLowerCase()).join(" ");
  const numbers = text.toLowerCase().match(/\b\d+(?:[/:.-]\d+)*\b/g) ?? [];
  const dates = text.toLowerCase().match(/\b(?:today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b/g) ?? [];
  return [...numbers, ...dates].every((term) => corpus.includes(term));
}

function inboundRequiresReply(text: string): boolean {
  return /\?|\b(?:wya|where are you|where|when|what|who|how|can you|could you|will you|would you|please|need an answer|send|confirm|let me know|any update)\b/i.test(text);
}

function isDecisionRequest(text: string): boolean {
  return /\?|\b(?:need an answer|let me know|confirm whether|confirm if|decide|your call|are you in|do you want|yes or no|should we|can you confirm)\b/i.test(text);
}

function peopleAreGrounded(text: string, messages: Message[]): boolean {
  const referenced = [...text.matchAll(/\b(?:ask|tell|connect|introduce|call|check with|send to)\s+([a-z][a-z'-]{1,})\b/gi)]
    .map((match) => match[1]?.toLowerCase())
    .filter((name): name is string => Boolean(name) && !GENERIC_PEOPLE.has(name));
  if (referenced.length === 0) return true;
  const corpus = messages
    .flatMap((message) => [message.text, message.sender?.name ?? ""])
    .join(" ")
    .toLowerCase();
  return referenced.every((name) => corpus.includes(name));
}

function claimsCompletedAction(text: string): boolean {
  return /\b(?:sent|confirmed|paid|booked|called|checked|shared|connected|handled|finished|completed)\b/i.test(text);
}

function completedActionIsGrounded(text: string, basis: Message[]): boolean {
  const claimed = text.toLowerCase().match(/\b(?:sent|confirmed|paid|booked|called|checked|shared|connected|handled|finished|completed)\b/g) ?? [];
  return claimed.every((verb) => basis.some((message) => message.text.toLowerCase().includes(verb)));
}

function contentTokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b(?:yeah|yea|yep|yes|no|nope|okay|ok|got it|sounds good|perfect|thanks|thank you)\b/g, " ")
    .replace(/[^a-z0-9']+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeStrategy(strategy: string, text: string, reaction: string): SuggestionStrategy {
  if (STRATEGIES.includes(strategy as SuggestionStrategy)) return strategy as SuggestionStrategy;
  if (reaction !== "none") return "react";
  if (text.includes("?")) return "clarify";
  if (/\b(?:pass|can't|cannot|won't|no thanks|release)\b/i.test(text)) return "decline";
  return "advance";
}

function defaultVibe(strategy: string): SuggestionVibe {
  switch (strategy) {
    case "clarify": return "curious";
    case "answer":
    case "advance": return "affirmative";
    case "decline": return "boundary";
    case "react": return "playful";
    default: return "cautious";
  }
}

function valueShape(value: object): string {
  if (Array.isArray(value)) return "array";
  if (!isRecord(value)) return typeof value;
  const suggestions = value.suggestions;
  const itemShape = Array.isArray(suggestions)
    ? suggestions.slice(0, 3).map((item) =>
        isRecord(item) ? `{${Object.keys(item).sort().join(",")}}` : typeof item
      ).join("|")
    : typeof suggestions;
  return `${Object.keys(value).sort().join(",")}; noReply=${typeof value.noReply}; suggestions=${itemShape}`;
}

function parseRawSet(value: object): RawSuggestionSet | null {
  if (!isRecord(value) || typeof value.noReply !== "boolean" || !Array.isArray(value.suggestions)) return null;
  const suggestions: RawSuggestion[] = [];
  for (const item of value.suggestions) {
    if (
      !isRecord(item) ||
      typeof item.strategy !== "string" ||
      typeof item.text !== "string"
    ) return null;
    const reaction = typeof item.reaction === "string" ? item.reaction : "none";
    const strategy = normalizeStrategy(item.strategy, item.text, reaction);
    suggestions.push({
      kind: typeof item.kind === "string"
        ? item.kind
        : reaction !== "none" ? "reaction" : "text",
      strategy,
      vibe: typeof item.vibe === "string" ? item.vibe : defaultVibe(strategy),
      text: item.text,
      reaction,
      targetMessageGuid: typeof item.targetMessageGuid === "string" ? item.targetMessageGuid : "",
      targetPartIndex: typeof item.targetPartIndex === "number" ? item.targetPartIndex : 0,
      basisMessageGuids: Array.isArray(item.basisMessageGuids)
        ? item.basisMessageGuids.filter((guid): guid is string => typeof guid === "string")
        : [],
      decisionOption: item.decisionOption === true,
      introducesCommitment: item.introducesCommitment === true,
    });
  }
  return { noReply: value.noReply, suggestions };
}

type JsonRecord = Record<string, object | string | number | boolean | string[] | null | undefined>;

function isRecord(value: object): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function suggestionId(): string {
  return `sg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const DECISION_TOKENS = new Set(["yes", "no", "yep", "nope", "accept", "decline"]);
const GENERIC_PEOPLE = new Set(["you", "them", "him", "her", "someone", "anyone", "everyone", "team", "guys"]);
const OPERATIONAL_TOKENS = new Set([
  "i'll", "we'll", "confirm", "send", "pay", "connect", "check", "call", "book", "share", "follow", "grab", "coordinate",
]);
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "i", "if", "in", "is", "it",
  "me", "my", "of", "on", "or", "our", "so", "that", "the", "their", "them", "this", "to", "we", "with", "you", "your",
]);
