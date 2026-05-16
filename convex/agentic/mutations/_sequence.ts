import type { DatabaseReader } from "../../_generated/server";

/**
 * Compute the next monotonic sequence value for an entity. Sequence space is
 * SHARED between `agenticThreadMessages` and `agenticThreadActivities` so the
 * UI can render them as one interleaved feed by ascending sequence.
 *
 * Always returns the max across BOTH tables plus 1. Returns 1 for a fresh entity.
 */
export async function nextSequence(
  db: DatabaseReader,
  entity_ref: string,
): Promise<number> {
  const lastMsg = await db
    .query("agenticThreadMessages")
    .withIndex("by_entity_ref_and_sequence", (q) =>
      q.eq("entity_ref", entity_ref),
    )
    .order("desc")
    .first();
  const lastAct = await db
    .query("agenticThreadActivities")
    .withIndex("by_entity_ref_and_sequence", (q) =>
      q.eq("entity_ref", entity_ref),
    )
    .order("desc")
    .first();
  return Math.max(lastMsg?.sequence ?? 0, lastAct?.sequence ?? 0) + 1;
}
