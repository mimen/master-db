export type TriageWriteOutcome = "done" | "busy";

/**
 * Holds one conversation to one outstanding triage write at a time.
 *
 * A triage write patches the conversation's flags optimistically, before the
 * network write resolves. The toggle then reads those flags to decide what the
 * gesture means. So a rapid double-press used to do this: the first press
 * computed settle, cleared the flags and fired dismiss; the second press read
 * the cleared flags, computed un-settle, and fired undismiss while the dismiss
 * was still in flight. The server landed settled while the client rendered
 * un-settled until the next refetch.
 *
 * The second press is rejected rather than queued. Queuing would run it against
 * the same stale snapshot it was computed from, so it would still resolve to the
 * opposite action and cost two round trips to end up where it started. A double
 * press of a toggle is a fumble, not a request to settle and immediately
 * un-settle.
 *
 * Keyed per conversation and never global. Writes to different conversations
 * cannot race each other, and fast triage across a queue has to stay fast.
 */
const inFlight = new Set<string>();

export async function runExclusiveTriageWrite(
  chatGuid: string,
  write: () => Promise<void>,
): Promise<TriageWriteOutcome> {
  if (inFlight.has(chatGuid)) return "busy";
  inFlight.add(chatGuid);
  try {
    await write();
  } finally {
    inFlight.delete(chatGuid);
  }
  return "done";
}

export function resetTriageWritesForTests(): void {
  inFlight.clear();
}
