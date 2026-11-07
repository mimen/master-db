import { hasSendError } from "@shared/imessage";
import type { Message } from "@shared/types";

/**
 * - `failed`: a send that failed, or whose outcome is unknown; tap to retry.
 * - `notSent`: a send that never went out; tap to retry.
 * - `uncertain`: a persisted error code with no evidence the message landed.
 * - `ok`: anything else.
 */
export type DeliveryState = "ok" | "failed" | "notSent" | "uncertain";

/** chat.db keeps stale error codes on messages that did deliver, so a young error is not yet a verdict. */
const ERROR_SETTLE_MS = 5 * 60_000;

export function deliveryState(message: Message, latestInboundAt: number | null, now: number): DeliveryState {
  if (message.sendState === "failed" || message.sendState === "notSent") return message.sendState;
  if (!message.isFromMe || !hasSendError(message)) return "ok";
  const evidence =
    message.dateDelivered !== null ||
    message.dateRead !== null ||
    (latestInboundAt !== null && latestInboundAt > message.dateCreated) ||
    now - message.dateCreated < ERROR_SETTLE_MS;
  return evidence ? "ok" : "uncertain";
}
