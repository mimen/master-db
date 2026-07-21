/**
 * Display formatting for raw handles/addresses (phone numbers, emails, short
 * codes). Used for BOTH the fallback name when a chat has no contact, and the
 * address subtitle in the details pane. Never mutate the address used for API
 * calls (avatar lookup, sending) — format only what a human reads.
 */

/** Strip a trailing BlueBubbles service annotation like "(smsfp)" / "(rcs)". */
export function stripServiceSuffix(raw: string): string {
  return raw.replace(/\s*\((?:sms|smsfp|mms|rcs|imessage|fp)[^)]*\)\s*$/i, "").trim();
}

/** Pretty-print a US/E.164 phone; leave emails and short codes untouched. */
export function formatPhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  // +1XXXXXXXXXX or XXXXXXXXXX → (XXX) XXX-XXXX
  if (digits.length === 11 && digits.startsWith("1")) {
    const d = digits.slice(1);
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw;
}

/** Clean a raw address for display: drop service suffix, prettify phones. */
export function formatAddress(raw: string): string {
  const cleaned = stripServiceSuffix(raw);
  if (cleaned.includes("@")) return cleaned; // email
  // A leading "+" or an all-digits handle of phone length is a phone number.
  if (/^\+?[\d\s().-]+$/.test(cleaned)) return formatPhone(cleaned);
  return cleaned;
}
