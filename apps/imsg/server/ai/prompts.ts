import { UNTRUSTED_NOTICE } from "./context";

/**
 * Prompt construction for the fast lane. Kept as pure string builders so the
 * shape of every prompt is unit-testable without touching the network.
 */

const VOICE = [
  "You are helping Milad, who runs Afternoon Umbrella Friends (AUF), an events and music brand.",
  "He texts dry, lowercase-ish, brief. No exclamation marks, no corporate warmth, no emoji unless he used one first.",
].join(" ");

export function groupNamePrompt(transcript: string, participants: string[]): string {
  return [
    "Suggest names for this group chat.",
    "",
    `Participants: ${participants.join(", ") || "unknown"}`,
    "",
    "Recent conversation:",
    transcript || "(no messages yet)",
    "",
    UNTRUSTED_NOTICE,
    "",
    "Rules:",
    "- 5 candidates, each at most 24 characters.",
    "- Draw on what this group actually is or does, not generic filler.",
    "- Range from plain-descriptive to funny; do not make them all jokes.",
    "- No quotes around the names, no numbering, no trailing punctuation.",
    "",
    'Reply with ONLY a JSON array of strings, e.g. ["Name one", "Name two"].',
  ].join("\n");
}

export function replySuggestionPrompt(
  transcript: string,
  profile: string,
  peerName: string | null,
): string {
  return [
    VOICE,
    "",
    profile ? `About Milad:\n${profile}\n` : "",
    `Draft replies Milad could send${peerName ? ` to ${peerName}` : ""}.`,
    "",
    "Conversation:",
    transcript || "(no messages yet)",
    "",
    UNTRUSTED_NOTICE,
    "",
    "Rules:",
    "- 3 options, each a complete message he could send as-is.",
    "- Each under 200 characters unless the thread clearly warrants more.",
    "- Make them genuinely different in intent, not three phrasings of one reply.",
    "- Match his voice. Never invent commitments, dates, or facts he has not stated.",
    "- If the last message needs no reply, still offer the most natural thing to say.",
    "",
    'Reply with ONLY a JSON array of strings, e.g. ["first", "second", "third"].',
  ]
    .filter(Boolean)
    .join("\n");
}

export interface IdentityCandidate {
  /** Where the hit came from, e.g. "vault" or "airtable". */
  source: string;
  name: string;
  detail: string;
}

export function identifyPrompt(
  address: string,
  transcript: string,
  candidates: IdentityCandidate[],
): string {
  const rendered =
    candidates.length > 0
      ? candidates.map((c) => `- ${c.name} (${c.source}): ${c.detail}`).join("\n")
      : "(no matches found in any source)";

  return [
    `Identify who ${address} is. Milad does not have them saved as a contact.`,
    "",
    "Candidate matches found by searching his notes and records:",
    rendered,
    "",
    "Conversation with this number:",
    transcript || "(no messages)",
    "",
    UNTRUSTED_NOTICE,
    "",
    "Rules:",
    "- Prefer a candidate only when the conversation corroborates it.",
    "- If nothing fits, infer what you can from the conversation alone and say so.",
    "- confidence: high only with corroborating evidence, low when guessing from tone.",
    "- reasoning: one short sentence naming the evidence.",
    "",
    'Reply with ONLY JSON: {"name": string | null, "confidence": "high" | "medium" | "low", "reasoning": string}',
  ].join("\n");
}
