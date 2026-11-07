/**
 * A message the user sent that has not landed as the platform's own copy yet. Convex shows it as a
 * pending row under `pendingGuid(clientKey)`, the outbox key of its send, until that copy arrives.
 *
 * - `queued`: waiting for the platform to take it. Cancelling removes it and it never goes out.
 * - `sending`: the platform has it, so it can no longer be cancelled.
 * - `notSent`: nothing took it within NOT_SENT_AFTER_MS, so it never went out and a retry is safe.
 * - `failed`: the platform refused it, or its outcome is unknown. Only the user can send it again.
 */
export type PendingSendState = "queued" | "sending" | "notSent" | "failed";

/** How long a send waits for the platform before it gives up as Not sent. */
export const NOT_SENT_AFTER_MS = 3 * 60_000;

/** The outbox error a send that gave up as Not sent carries. */
export const NOT_SENT_ERROR = "not sent: nothing picked it up in time";

const PREFIX = "temp-";

export function pendingGuid(clientKey: string): string {
  return `${PREFIX}${clientKey}`;
}

export function isPendingGuid(guid: string): boolean {
  return guid.startsWith(PREFIX);
}

/** The outbox key a pending row belongs to, or null for a real message. */
export function pendingClientKey(guid: string): string | null {
  return isPendingGuid(guid) ? guid.slice(PREFIX.length) : null;
}
