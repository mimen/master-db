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
  // The candidate's final chat_count for THIS run (see resolve.ts's
  // aggregateIdentityCandidates) — a count of distinct chats it appeared in
  // this run, not a running total. upsertIdentityCandidate SETs this field.
  chat_count: v.number(),
});

export type IdentityCandidate = {
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
  chat_count: number;
};

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

export type UpsertOutcome = "inserted" | "updated" | "unchanged";

/**
 * Upsert one identity candidate. Dedupe key is (network, value).
 *
 * chat_count is SET from the candidate's own (already run-aggregated)
 * chat_count, not incremented — resolveIdentities re-derives it from scratch
 * every run (see resolve.ts's aggregateIdentityCandidates), so a handle that
 * appears in fewer chats than last run should see its chat_count go DOWN,
 * and a re-run over unchanged data must reproduce the exact same value, not
 * grow it. The other fields keep their existing merge-against-stored-row
 * rules: longest display_name wins, last_seen_at only advances, is_self is
 * sticky, phone_number/img_url are first-wins (kept once set).
 *
 * Building the patch from only the fields that actually differ — and
 * skipping the patch (including updated_at) entirely when nothing changed —
 * matters because this now runs on a daily cron over every identity the
 * chats currently reference: an unconditional patch would rewrite every row
 * (and bump updated_at, invalidating every subscribed query) on every run
 * even when the underlying chats haven't changed at all.
 *
 * Exported as a plain function (ctx + one candidate in, outcome out) so it's
 * testable directly via convex-test's `t.run`, same pattern as
 * ingestContacts.ts's ingestOneCard.
 */
export async function upsertIdentityCandidate(
  ctx: MutationCtx,
  it: IdentityCandidate,
): Promise<UpsertOutcome> {
  const now = new Date().toISOString();
  const matches = await ctx.db
    .query("identities")
    .withIndex("by_value", (q) => q.eq("value", it.value))
    .collect();
  const existing = matches.find((m) => m.network === it.network);

  if (!existing) {
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
      chat_count: it.chat_count,
      is_self: it.is_self,
      source: it.source,
      first_seen_at: it.last_seen_at ?? now,
      last_seen_at: it.last_seen_at ?? now,
      created_at: now,
      updated_at: now,
    });
    return "inserted";
  }

  const nextDisplayName =
    it.display_name && it.display_name.length > (existing.display_name?.length ?? 0)
      ? it.display_name
      : existing.display_name;
  const nextImgUrl = existing.img_url ?? it.img_url;
  const nextPhoneNumber = existing.phone_number ?? it.phone_number;
  const nextLastSeenAt =
    it.last_seen_at && (!existing.last_seen_at || it.last_seen_at > existing.last_seen_at)
      ? it.last_seen_at
      : existing.last_seen_at;
  const nextIsSelf = existing.is_self || it.is_self;

  const unchanged =
    existing.chat_count === it.chat_count &&
    existing.display_name === nextDisplayName &&
    existing.img_url === nextImgUrl &&
    existing.phone_number === nextPhoneNumber &&
    existing.last_seen_at === nextLastSeenAt &&
    existing.is_self === nextIsSelf;
  if (unchanged) return "unchanged";

  await ctx.db.patch(existing._id, {
    chat_count: it.chat_count,
    display_name: nextDisplayName,
    img_url: nextImgUrl,
    phone_number: nextPhoneNumber,
    last_seen_at: nextLastSeenAt,
    is_self: nextIsSelf,
    updated_at: now,
  });
  return "updated";
}

/** Upsert a batch of already run-aggregated identity candidates — see upsertIdentityCandidate. */
export const upsertIdentitiesBatch = internalMutation({
  args: { items: v.array(identityCandidate) },
  handler: async (ctx, { items }) => {
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    for (const it of items) {
      const outcome = await upsertIdentityCandidate(ctx, it);
      if (outcome === "inserted") inserted++;
      else if (outcome === "updated") updated++;
      else unchanged++;
    }
    return { inserted, updated, unchanged };
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
 *
 * display_name is skipped when the person has display_name_locked set — a
 * human explicitly named them (via "Add Contact" or an in-app rename), and
 * the next sync re-deriving "longest name among identities" must not
 * silently revert that. Every other aggregate still recomputes normally.
 *
 * Skips the patch entirely when the computed aggregates match the current
 * doc — this runs on every ingested card in the ~1,510-card / 10-minute
 * Apple Contacts sync, and an unconditional patch would rewrite every
 * person doc (and bump updated_at, invalidating every subscribed query) on
 * every cycle even when nothing changed. Phones/emails are compared as sets
 * so `Set` iteration order can't cause a false "changed" every run.
 */
export async function recomputePersonAggregates(
  ctx: MutationCtx,
  personId: Id<"people">,
): Promise<void> {
  const person = await ctx.db.get(personId);
  if (!person) return;
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

  const nextDisplayName = person.display_name_locked ? person.display_name : bestName;
  const samePhones = setsEqual(new Set(person.normalized_phones), phones);
  const sameEmails = setsEqual(new Set(person.normalized_emails), emails);
  const unchanged =
    person.display_name === nextDisplayName &&
    samePhones &&
    sameEmails &&
    person.identity_count === all.length &&
    person.message_count === messageCount &&
    person.is_self === isSelf;
  if (unchanged) return;

  const now = new Date().toISOString();
  await ctx.db.patch(personId, {
    ...(person.display_name_locked ? {} : { display_name: bestName }),
    normalized_phones: [...phones],
    normalized_emails: [...emails],
    identity_count: all.length,
    message_count: messageCount,
    is_self: isSelf,
    updated_at: now,
  });
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
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
