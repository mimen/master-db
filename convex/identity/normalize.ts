/**
 * Normalization helpers for the identity graph. The whole clustering model hinges
 * on `normalized` being a stable join key: two handles for the same human (a
 * WhatsApp JID and a Google Messages number) must normalize to the same string.
 */

/** Lowercase + trim an email; returns "" if it doesn't look like one. */
export function normalizeEmail(raw: string): string {
  const s = raw.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? s : "";
}

/**
 * Best-effort E.164. Strips everything but digits (and a leading +), then
 * applies a US default for bare 10-digit / 11-digit-leading-1 numbers, which is
 * the overwhelming majority of Milad's contacts. Returns "" if it can't make a
 * plausible phone (too few digits).
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

/** Map a Beeper network name to an identity `kind`. */
export function kindForNetwork(network: string | undefined): string {
  switch ((network ?? "").toLowerCase()) {
    case "whatsapp":
      return "whatsapp";
    case "google messages":
    case "gmessages":
      return "gmessages";
    case "imessage":
      return "imessage";
    case "telegram":
      return "telegram";
    case "slack":
    case "slackgo":
      return "slack";
    case "signal":
      return "signal";
    case "matrix":
      return "matrix";
    default:
      return "other";
  }
}

/**
 * Derive the best (normalized, normalizationKind) for one participant. Phone
 * wins when present; otherwise try email; otherwise empty (won't cluster).
 */
export function deriveNormalized(
  value: string,
  phoneNumber: string | undefined,
): { normalized: string; via: "phone" | "email" | "none" } {
  const phone = normalizePhone(phoneNumber ?? "") || normalizePhone(value);
  if (phone) return { normalized: phone, via: "phone" };
  const email = normalizeEmail(value);
  if (email) return { normalized: email, via: "email" };
  return { normalized: "", via: "none" };
}
