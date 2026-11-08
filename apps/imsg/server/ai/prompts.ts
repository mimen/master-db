import { UNTRUSTED_NOTICE } from "./context";

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
    "Conversation with them:",
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
