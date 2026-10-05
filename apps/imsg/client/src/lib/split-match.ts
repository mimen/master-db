export interface MatchSplit {
  before: string;
  match: string;
  after: string;
}

/** Characters of lead kept before a match, so a one-line snippet still shows the hit. */
const LEAD = 32;

/**
 * Splits `text` around the first case-insensitive occurrence of `needle` so the match can be
 * bolded. A long lead is cut to its last LEAD characters behind an ellipsis; null on no match.
 */
export function splitAroundMatch(text: string, needle: string): MatchSplit | null {
  const n = needle.trim().toLowerCase();
  if (n === "") return null;
  const at = text.toLowerCase().indexOf(n);
  if (at === -1) return null;
  const lead = text.slice(0, at);
  return {
    before: lead.length > LEAD ? `…${lead.slice(-LEAD).trimStart()}` : lead,
    match: text.slice(at, at + n.length),
    after: text.slice(at + n.length),
  };
}
