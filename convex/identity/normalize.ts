import { normalizeEmail, normalizePhone } from "../../apps/imsg/shared/address";

/**
 * Normalization helpers for the identity graph. Phones and emails normalize by their handle kind's rules in
 * apps/imsg/shared/address.ts. The whole clustering model hinges
 * on `normalized` being a stable join key: two handles for the same human (a
 * WhatsApp JID and a Google Messages number) must normalize to the same string.
 */

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
