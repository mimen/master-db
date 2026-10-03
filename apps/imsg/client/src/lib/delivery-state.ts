import type { Message } from "@shared/types";

/**
 * - `failed`: this session's own send failed; tap to retry.
 * - `uncertain`: a persisted error code with no evidence the message landed.
 * - `ok`: anything else.
 */
export type DeliveryState = "ok" | "failed" | "uncertain";

/** chat.db keeps stale error codes on messages that did deliver, so a young error is not yet a verdict. */
const ERROR_SETTLE_MS = 5 * 60_000;

export function deliveryState(message: Message, latestInboundAt: number | null, now: number): DeliveryState {
  if (message.failed) return "failed";
  if (!message.isFromMe || message.error === 0) return "ok";
  const evidence =
    message.dateDelivered !== null ||
    message.dateRead !== null ||
    (latestInboundAt !== null && latestInboundAt > message.dateCreated) ||
    now - message.dateCreated < ERROR_SETTLE_MS;
  return evidence ? "ok" : "uncertain";
}
