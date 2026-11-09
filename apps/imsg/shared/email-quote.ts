/** The lines where a reply's quoted history starts, as Gmail, Apple Mail and Outlook write them. */
export const QUOTE_START = [
  /^On .+(\n.+)?wrote:\s*$/m,
  /^-{2,}\s*(Original Message|Forwarded message)\s*-{2,}/im,
  /^From: .+\n(Sent|Date): /m,
  /^_{10,}\s*$/m,
];

/**
 * A plain-text email split where its quoted history starts: the first attribution line or `>` line. Null when it quotes
 * nothing, or when the quote is all there is, as in a bare forward.
 */
export function splitQuote(text: string): { fresh: string; quote: string } | null {
  const normal = text.replace(/\r\n/g, "\n");
  const starts = [...QUOTE_START, /^>/m].flatMap((pattern) => pattern.exec(normal)?.index ?? []);
  if (!starts.length) return null;
  const at = Math.min(...starts);
  const fresh = normal.slice(0, at).trimEnd();
  return fresh.trim() ? { fresh, quote: normal.slice(at) } : null;
}
