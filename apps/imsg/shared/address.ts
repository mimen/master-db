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

/**
 * Matching (not formatting) — the canonical "is this the same handle" answer,
 * shared by every place in imsg that needs it: the server's ContactBook
 * (Apple Contacts via BlueBubbles) and the client's person-view (matching a
 * Convex identity's phones/emails against a chat's participants). Both used
 * to hand-roll their own last-10-digit-suffix logic; this is the one copy.
 *
 * Deliberately loose (last-10-digit suffix, not full E.164) — the two
 * services being matched here format the same real phone number
 * differently, and this is the level of strictness that actually bridges
 * them. convex/identity/normalize.ts's normalizePhone is stricter (full
 * E.164) because it's deriving a canonical join key from scratch, a
 * different job than "do these two already-known handles match."
 */

/** Last-10-digit suffix, the phone join key. Empty string if too short to be a confident match. */
export function phoneMatchKey(address: string): string {
  const digits = address.replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-10) : "";
}

/** Lowercased email, the email join key. Empty string if the address isn't email-shaped. */
export function emailMatchKey(address: string): string {
  return address.includes("@") ? address.toLowerCase() : "";
}

/** True if two raw addresses are the same handle — same phone (by last-10-digit suffix) or same email (case-insensitive). */
export function addressesMatch(a: string, b: string): boolean {
  const emailA = emailMatchKey(a);
  if (emailA && emailA === emailMatchKey(b)) return true;
  const phoneA = phoneMatchKey(a);
  return Boolean(phoneA) && phoneA === phoneMatchKey(b);
}

/** True if `candidate` matches any address in `known` (phone or email). */
export function matchesAnyAddress(candidate: string, known: string[]): boolean {
  return known.some((k) => addressesMatch(candidate, k));
}
