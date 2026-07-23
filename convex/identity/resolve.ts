import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";

import { deriveNormalized, kindForNetwork } from "./normalize";

/**
 * Build the identity graph from already-ingested Beeper data.
 *
 * Phase 1 — walk every chat's participant list, aggregate one candidate per
 * distinct (network, value) across the WHOLE run (see aggregateIdentityCandidates),
 * then upsert the aggregated candidates.
 * Phase 2 — group identities by their normalized join key (E.164 phone or
 * lowercased email) and attach each group to a single person.
 *
 * Idempotent by design: this is a scheduled cron (see crons.ts), so every run
 * must reproduce the same identities table a re-run of the SAME underlying
 * chats would produce — not accumulate on top of the previous run. That's why
 * Phase 1 aggregates in memory before writing anything: chat_count is a SET of
 * "how many chats this run saw the handle in", not an increment (see
 * internal.ts's upsertIdentitiesBatch docstring for the full rationale).
 *
 * Phone is the dominant join key; cross-key linking (a person's phone AND
 * email) and per-identity message counts are deliberately out of scope for
 * this pass — see notes.
 */

/** One raw sighting of a handle in one chat — one per (chat, participant). */
export type RawIdentityCandidate = {
  network?: string;
  value: string;
  kind: string;
  normalized: string;
  display_name?: string;
  phone_number?: string;
  img_url?: string;
  is_self: boolean;
  source: string;
  last_seen_at?: string;
};

/** One raw candidate merged across every chat it appeared in, this run. */
export type AggregatedIdentityCandidate = RawIdentityCandidate & {
  /** Number of distinct chats this run saw (network, value) in. */
  chat_count: number;
};

/**
 * Merge raw per-chat sightings into one candidate per (network, value), with
 * a within-run chat_count. Merge rules mirror upsertIdentitiesBatch's
 * existing-row merge rules so aggregating-then-upserting behaves the same as
 * upserting-then-merging-against-the-stored-row did before:
 *  - chat_count: count of raw sightings for this key (i.e. distinct chats).
 *  - display_name: longest wins.
 *  - last_seen_at: max (only advances).
 *  - is_self: OR'd across sightings.
 *  - phone_number / img_url / kind / normalized / source: first-wins.
 *
 * Exported as a pure function (no ctx, no I/O) so it's directly unit
 * testable without convex-test or real chat pagination.
 */
export function aggregateIdentityCandidates(
  raws: readonly RawIdentityCandidate[],
): AggregatedIdentityCandidate[] {
  const byKey = new Map<string, AggregatedIdentityCandidate>();
  for (const r of raws) {
    const key = `${r.network ?? ""}:${r.value}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...r, chat_count: 1 });
      continue;
    }
    existing.chat_count += 1;
    if (r.display_name && r.display_name.length > (existing.display_name?.length ?? 0)) {
      existing.display_name = r.display_name;
    }
    if (r.last_seen_at && (!existing.last_seen_at || r.last_seen_at > existing.last_seen_at)) {
      existing.last_seen_at = r.last_seen_at;
    }
    existing.is_self = existing.is_self || r.is_self;
    existing.phone_number = existing.phone_number ?? r.phone_number;
    existing.img_url = existing.img_url ?? r.img_url;
  }
  return [...byKey.values()];
}

export const resolveIdentities = internalAction({
  args: {},
  handler: async (ctx) => {
    // ---- Phase 1a: read every chat's participants into memory ----
    let cursor: string | null = null;
    let chatsSeen = 0;
    const raw: RawIdentityCandidate[] = [];
    for (;;) {
      const page: {
        isDone: boolean;
        continueCursor: string;
        chats: Array<{
          network?: string;
          last_activity?: string;
          participants: Array<{
            id: string;
            phone_number?: string;
            full_name?: string;
            is_self?: boolean;
            is_admin?: boolean;
            img_url?: string;
          }>;
        }>;
      } = await ctx.runQuery(internal.identity.internal.listChatsPage, {
        cursor,
        numItems: 200,
      });
      for (const chat of page.chats) {
        chatsSeen++;
        for (const p of chat.participants) {
          if (!p.id) continue;
          const { normalized } = deriveNormalized(p.id, p.phone_number);
          raw.push({
            network: chat.network,
            value: p.id,
            kind: kindForNetwork(chat.network),
            normalized,
            display_name: p.full_name,
            phone_number: p.phone_number,
            img_url: p.img_url,
            is_self: p.is_self ?? false,
            source: "participant",
            last_seen_at: chat.last_activity,
          });
        }
      }
      if (page.isDone) break;
      cursor = page.continueCursor;
    }

    // ---- Phase 1b: aggregate across the whole run, then upsert in sub-batches ----
    const aggregated = aggregateIdentityCandidates(raw);
    let candidates = 0;
    for (let i = 0; i < aggregated.length; i += 100) {
      const slice = aggregated.slice(i, i + 100);
      candidates += slice.length;
      await ctx.runMutation(internal.identity.internal.upsertIdentitiesBatch, {
        items: slice,
      });
    }

    // ---- Phase 2: cluster identities by normalized key ----
    const groups = new Map<string, Array<Id<"identities">>>();
    cursor = null;
    for (;;) {
      const page: {
        isDone: boolean;
        continueCursor: string;
        identities: Array<{ _id: Id<"identities">; normalized: string }>;
      } = await ctx.runQuery(internal.identity.internal.listIdentitiesPage, {
        cursor,
        numItems: 500,
      });
      for (const i of page.identities) {
        if (!i.normalized) continue; // no join key → leave unclustered
        const arr = groups.get(i.normalized) ?? [];
        arr.push(i._id);
        groups.set(i.normalized, arr);
      }
      if (page.isDone) break;
      cursor = page.continueCursor;
    }

    let clusters = 0;
    for (const [, identityIds] of groups) {
      await ctx.runMutation(internal.identity.internal.assignCluster, {
        identityIds,
      });
      clusters++;
    }

    const stats = await ctx.runQuery(internal.identity.internal.stats, {});
    return { chatsSeen, candidates, clusters, ...stats };
  },
});
