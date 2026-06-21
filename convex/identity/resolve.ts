import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";

import { deriveNormalized, kindForNetwork } from "./normalize";

/**
 * Build the identity graph from already-ingested Beeper data.
 *
 * Phase 1 — walk every chat's participant list and upsert one identity per
 * distinct (network, handle).
 * Phase 2 — group identities by their normalized join key (E.164 phone or
 * lowercased email) and attach each group to a single person.
 *
 * Idempotent: safe to re-run after new chats are ingested. Phone is the dominant
 * join key; cross-key linking (a person's phone AND email) and per-identity
 * message counts are deliberately out of scope for this pass — see notes.
 */
export const resolveIdentities = internalAction({
  args: {},
  handler: async (ctx) => {
    // ---- Phase 1: extract identities from chat participants ----
    let cursor: string | null = null;
    let chatsSeen = 0;
    let candidates = 0;
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
      const batch: Array<{
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
      }> = [];
      for (const chat of page.chats) {
        chatsSeen++;
        for (const p of chat.participants) {
          if (!p.id) continue;
          const { normalized } = deriveNormalized(p.id, p.phone_number);
          batch.push({
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
      // Upsert in sub-batches to keep each mutation small.
      for (let i = 0; i < batch.length; i += 100) {
        const slice = batch.slice(i, i + 100);
        candidates += slice.length;
        await ctx.runMutation(internal.identity.internal.upsertIdentitiesBatch, {
          items: slice,
        });
      }
      if (page.isDone) break;
      cursor = page.continueCursor;
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
