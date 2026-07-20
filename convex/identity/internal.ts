import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "../_generated/server";

/**
 * Internal building blocks for the identity resolver. The orchestration lives in
 * resolve.ts (an action); these are the paged reads and small idempotent writes
 * it calls so each mutation stays well inside Convex's per-call limits.
 */

const identityCandidate = v.object({
  network: v.optional(v.string()),
  value: v.string(),
  kind: v.string(),
  normalized: v.string(),
  display_name: v.optional(v.string()),
  phone_number: v.optional(v.string()),
  img_url: v.optional(v.string()),
  is_self: v.boolean(),
  source: v.string(),
  last_seen_at: v.optional(v.string()),
});

/** Page through beeper_chats, returning just the fields the resolver needs. */
export const listChatsPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  handler: async (ctx, { cursor, numItems }) => {
    const page = await ctx.db
      .query("beeper_chats")
      .paginate({ cursor, numItems });
    return {
      isDone: page.isDone,
      continueCursor: page.continueCursor,
      chats: page.page.map((c) => ({
        network: c.network,
        participants: c.participants,
        last_activity: c.last_activity,
      })),
    };
  },
});

/**
 * Idempotent upsert of a batch of identity candidates. Dedupe key is
 * (network, value): the same raw handle seen in another chat just bumps
 * chat_count and refreshes last_seen / display_name.
 */
export const upsertIdentitiesBatch = internalMutation({
  args: { items: v.array(identityCandidate) },
  handler: async (ctx, { items }) => {
    const now = new Date().toISOString();
    let inserted = 0;
    let updated = 0;
    for (const it of items) {
      const matches = await ctx.db
        .query("identities")
        .withIndex("by_value", (q) => q.eq("value", it.value))
        .collect();
      const existing = matches.find((m) => m.network === it.network);
      if (existing) {
        await ctx.db.patch(existing._id, {
          chat_count: existing.chat_count + 1,
          display_name:
            it.display_name && it.display_name.length > (existing.display_name?.length ?? 0)
              ? it.display_name
              : existing.display_name,
          img_url: existing.img_url ?? it.img_url,
          phone_number: existing.phone_number ?? it.phone_number,
          last_seen_at:
            it.last_seen_at && (!existing.last_seen_at || it.last_seen_at > existing.last_seen_at)
              ? it.last_seen_at
              : existing.last_seen_at,
          is_self: existing.is_self || it.is_self,
          updated_at: now,
        });
        updated++;
      } else {
        await ctx.db.insert("identities", {
          person_id: undefined,
          kind: it.kind,
          value: it.value,
          normalized: it.normalized,
          network: it.network,
          display_name: it.display_name,
          phone_number: it.phone_number,
          img_url: it.img_url,
          message_count: 0,
          chat_count: 1,
          is_self: it.is_self,
          source: it.source,
          first_seen_at: it.last_seen_at ?? now,
          last_seen_at: it.last_seen_at ?? now,
          created_at: now,
          updated_at: now,
        });
        inserted++;
      }
    }
    return { inserted, updated };
  },
});

/** Page through identities, returning the minimal fields needed to cluster. */
export const listIdentitiesPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  handler: async (ctx, { cursor, numItems }) => {
    const page = await ctx.db
      .query("identities")
      .withIndex("by_normalized")
      .paginate({ cursor, numItems });
    return {
      isDone: page.isDone,
      continueCursor: page.continueCursor,
      identities: page.page.map((i) => ({
        _id: i._id,
        normalized: i.normalized,
      })),
    };
  },
});

/**
 * Recompute a person's denormalized aggregates (display_name, phones, emails,
 * counts) from the authoritative set: every identity currently pointing at
 * them. Shared by assignCluster (resolver-inferred grouping) and the
 * source-trusted ingest mutations (e.g. Apple Contacts) so both converge on
 * re-runs using the exact same merge rules.
 */
export async function recomputePersonAggregates(
  ctx: MutationCtx,
  personId: Id<"people">,
): Promise<void> {
  const now = new Date().toISOString();
  const all = await ctx.db
    .query("identities")
    .withIndex("by_person", (q) => q.eq("person_id", personId))
    .collect();
  const phones = new Set<string>();
  const emails = new Set<string>();
  let messageCount = 0;
  let isSelf = false;
  let bestName: string | undefined;
  for (const i of all) {
    if (i.normalized.includes("@")) emails.add(i.normalized);
    else if (i.normalized) phones.add(i.normalized);
    messageCount += i.message_count;
    isSelf = isSelf || i.is_self;
    if (i.display_name && i.display_name.length > (bestName?.length ?? 0)) {
      bestName = i.display_name;
    }
  }
  await ctx.db.patch(personId, {
    display_name: bestName,
    normalized_phones: [...phones],
    normalized_emails: [...emails],
    identity_count: all.length,
    message_count: messageCount,
    is_self: isSelf,
    updated_at: now,
  });
}

/**
 * Attach every identity sharing one normalized key to a single person, creating
 * the person if none of them is attached yet. Recomputes the person's aggregates
 * from its full identity set so re-runs converge.
 */
export const assignCluster = internalMutation({
  args: { identityIds: v.array(v.id("identities")) },
  handler: async (ctx, { identityIds }) => {
    if (identityIds.length === 0) return null;
    const now = new Date().toISOString();

    const ids = (await Promise.all(identityIds.map((id) => ctx.db.get(id)))).filter(
      (x): x is NonNullable<typeof x> => x !== null,
    );
    if (ids.length === 0) return null;

    // Reuse an existing (non-merged) person if any identity already points at one.
    let personId = null as null | (typeof ids)[number]["person_id"];
    for (const i of ids) {
      if (i.person_id) {
        const p = await ctx.db.get(i.person_id);
        if (p && !p.merged_into) {
          personId = i.person_id;
          break;
        }
      }
    }

    if (!personId) {
      personId = await ctx.db.insert("people", {
        display_name: undefined,
        normalized_phones: [],
        normalized_emails: [],
        identity_count: 0,
        message_count: 0,
        is_self: false,
        auto_clustered: true,
        created_at: now,
        updated_at: now,
      });
    }

    for (const i of ids) {
      if (i.person_id !== personId) {
        await ctx.db.patch(i._id, { person_id: personId, updated_at: now });
      }
    }

    await recomputePersonAggregates(ctx, personId);
    return personId;
  },
});

/** Aggregate counts for reporting. */
export const stats = internalQuery({
  args: {},
  handler: async (ctx) => {
    const identities = await ctx.db.query("identities").collect();
    const people = await ctx.db.query("people").collect();
    const unresolved = identities.filter((i) => !i.person_id).length;
    const noKey = identities.filter((i) => !i.normalized).length;
    const multiIdentity = people.filter((p) => p.identity_count > 1).length;
    return {
      identities: identities.length,
      unresolved,
      noNormalizedKey: noKey,
      people: people.length,
      peopleWithMultipleIdentities: multiIdentity,
    };
  },
});
