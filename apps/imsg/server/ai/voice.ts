import type { OverlayDb, SuggestionFeedbackRow } from "../db";

export interface VoiceState {
  globalStyle: string;
  editRules: string[];
  voiceRevision: number;
  editRevision: number;
}

export function loadVoiceState(db: OverlayDb, globalOutbound: string[]): VoiceState {
  const globalStyle = deriveGlobalStyle(globalOutbound);
  const editRules = deriveEditRules(db.listSuggestionFeedback(20));
  db.setAiMeta("suggestion_voice_profile_v1", globalStyle);
  db.setAiMeta("suggestion_edit_rules_v1", JSON.stringify(editRules));
  return {
    globalStyle,
    editRules,
    voiceRevision: revision(globalStyle),
    editRevision: revision(JSON.stringify(editRules)),
  };
}

export function deriveGlobalStyle(messages: string[]): string {
  if (messages.length === 0) return "";
  const lengths = messages.map((message) => message.length).sort((a, b) => a - b);
  const median = lengths[Math.floor(lengths.length / 2)] ?? 0;
  const lowercase = ratio(messages, (message) => message === message.toLowerCase());
  const noTerminal = ratio(messages, (message) => !/[.!?]$/.test(message.trim()));
  const exclamations = ratio(messages, (message) => message.includes("!"));
  const emoji = ratio(messages, containsEmoji);
  return [
    `Typical sent message length is about ${median} characters.`,
    `${percent(lowercase)} are entirely lowercase.`,
    `${percent(noTerminal)} omit terminal punctuation.`,
    `Exclamation marks appear in ${percent(exclamations)}; emoji appear in ${percent(emoji)}.`,
    "Match these aggregate tendencies without copying content from other conversations.",
  ].join(" ");
}

export function deriveEditRules(rows: SuggestionFeedbackRow[]): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const suggested = row.suggested_text.trim();
    const final = row.final_text.trim();
    if (startsWithAcknowledgment(suggested) && !startsWithAcknowledgment(final)) bump(counts, "Skip acknowledgment openings; lead with the useful move.");
    if (final.length <= suggested.length * 0.75) bump(counts, "Prefer drafts roughly 25% shorter.");
    if (suggested.includes("!") && !final.includes("!")) bump(counts, "Avoid exclamation marks.");
    if (containsEmoji(suggested) && !containsEmoji(final)) bump(counts, "Do not add emoji unless the thread makes it necessary.");
    if (final === final.toLowerCase() && suggested !== suggested.toLowerCase()) bump(counts, "Keep text lowercase-casual.");
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .map(([rule]) => rule);
}

function ratio(messages: string[], predicate: (message: string) => boolean): number {
  return messages.filter(predicate).length / messages.length;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function containsEmoji(text: string): boolean {
  return /\p{Extended_Pictographic}/u.test(text);
}

function startsWithAcknowledgment(text: string): boolean {
  return /^(?:yeah|yea|yep|yes|ok(?:ay)?|got it|sounds good|perfect|thanks|thank you)\b[,.! ]*/i.test(text);
}

function bump(counts: Map<string, number>, rule: string): void {
  counts.set(rule, (counts.get(rule) ?? 0) + 1);
}

function revision(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
