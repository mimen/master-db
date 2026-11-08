import { dmAddress } from "./imessage";
import type { ChatSummary, ConversationId } from "./types";

/**
 * Participant and sender addresses. An address is a bare string as its platform presents it; its kind decides how
 * it normalizes, matches and displays. `parseHandle` is the one place that decides the kind, and `HANDLES` holds each
 * kind's rules. Format only what a person reads; never rewrite the address used for sends or lookups.
 */

/** What an address is, named as `identities.kind` names it. */
export type HandleKind = "phone" | "email" | "slack";

/** An address parsed: its kind, and its text without a BlueBubbles service suffix. */
export interface Handle {
  kind: HandleKind;
  address: string;
}

interface HandleRules {
  /** The identity graph's join key (`identities.normalized`), or "" when this spelling has none. */
  normalize(address: string): string;
  /**
   * The key two services' spellings of one handle share, or "" when too weak to match on. Looser than
   * `normalize` for phones (the last ten digits), because Apple Contacts and BlueBubbles format one number
   * differently and the suffix is what bridges them.
   */
  matchKey(address: string): string;
  format(address: string): string;
}

/** Strip a trailing BlueBubbles service annotation like "(smsfp)" / "(rcs)". */
export function stripServiceSuffix(raw: string): string {
  return raw.replace(/\s*\((?:sms|smsfp|mms|rcs|imessage|fp)[^)]*\)\s*$/i, "").trim();
}

/** Lowercase + trim an email; returns "" if it doesn't look like one. */
export function normalizeEmail(raw: string): string {
  const s = raw.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? s : "";
}

/**
 * Best-effort E.164. Strips everything but digits (and a leading +), then applies a US default for bare
 * 10-digit / 11-digit-leading-1 numbers, which is the overwhelming majority of Milad's contacts. Returns "" if
 * it can't make a plausible phone (too few digits).
 */
export function normalizePhone(raw: string): string {
  if (!raw) return "";
  let s = raw.trim();
  // Pull a phone out of a JID-ish handle like "+15551234567@s.whatsapp.net".
  const at = s.indexOf("@");
  if (at !== -1) s = s.slice(0, at);
  const hadPlus = s.trimStart().startsWith("+");
  const digits = s.replace(/[^0-9]/g, "");
  if (digits.length < 7) return "";
  if (hadPlus) return "+" + digits;
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  // 11–15 digit international without a plus: trust it as-is.
  if (digits.length >= 11 && digits.length <= 15) return "+" + digits;
  return "";
}

/** Pretty-print a US/E.164 phone; leave anything else untouched. */
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

export const HANDLES: Readonly<Record<HandleKind, HandleRules>> = {
  phone: {
    normalize: normalizePhone,
    matchKey(address) {
      const digits = address.replace(/\D/g, "");
      return digits.length >= 7 ? digits.slice(-10) : "";
    },
    // A short code or an alphanumeric sender id shows as it is.
    format: (address) => (/^\+?[\d\s().-]+$/.test(address) ? formatPhone(address) : address),
  },
  email: {
    normalize: normalizeEmail,
    matchKey: (address) => address.toLowerCase(),
    format: (address) => address,
  },
  slack: {
    normalize: (address) => address,
    matchKey: (address) => address,
    // A Slack user id means nothing to a reader; Name Resolution supplies the name once the graph has it.
    format: () => "Slack user",
  },
};

/**
 * The kind of a raw address: `slack:` and a user id, anything with an `@`, else a phone number, short code or
 * sender id. Null for an empty address or another scheme.
 */
export function parseHandle(raw: string): Handle | null {
  const address = stripServiceSuffix(raw);
  if (!address) return null;
  if (address.startsWith("slack:")) return { kind: "slack", address };
  if (address.includes("@")) return { kind: "email", address };
  if (/^[a-z]+:/.test(address)) return null;
  return { kind: "phone", address };
}

/** The identity graph's key for a raw address, or "" when it has none. */
export function normalizeHandle(raw: string): string {
  const handle = parseHandle(raw);
  return handle ? HANDLES[handle.kind].normalize(handle.address) : "";
}

/** The match key for a raw address, or "" when too weak to match on. Keys of different kinds never collide. */
export function handleMatchKey(raw: string): string {
  const handle = parseHandle(raw);
  return handle ? HANDLES[handle.kind].matchKey(handle.address) : "";
}

/** A raw address as a person reads it. */
export function formatAddress(raw: string): string {
  const handle = parseHandle(raw);
  return handle ? HANDLES[handle.kind].format(handle.address) : stripServiceSuffix(raw);
}

/** True if two raw addresses are the same handle: same kind and same match key. */
export function addressesMatch(a: string, b: string): boolean {
  const key = handleMatchKey(a);
  return Boolean(key) && key === handleMatchKey(b);
}

/** True if `candidate` matches any address in `known`. */
export function matchesAnyAddress(candidate: string, known: readonly string[]): boolean {
  return known.some((k) => addressesMatch(candidate, k));
}

/**
 * For one-to-one chats whose display name repeats, the handle that tells them apart
 * (one person's second number, email, or SMS line). Keyed by conversation; absent means
 * the name is already unique and needs no label.
 */
export function disambiguators(
  chats: readonly Pick<ChatSummary, "conversationId" | "displayName" | "isGroup" | "participants" | "route">[],
): Map<ConversationId, string> {
  const byName = new Map<string, typeof chats[number][]>();
  for (const chat of chats) {
    if (chat.isGroup) continue;
    const list = byName.get(chat.displayName) ?? [];
    list.push(chat);
    byName.set(chat.displayName, list);
  }
  const labels = new Map<ConversationId, string>();
  for (const list of byName.values()) {
    if (list.length < 2) continue;
    for (const chat of list) {
      labels.set(chat.conversationId, formatAddress(dmAddress(chat) ?? ""));
    }
  }
  return labels;
}
