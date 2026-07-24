import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { query } from "../_generated/server";

import { requireIdentityKey } from "./key";
import { normalizeEmail, normalizePhone } from "./normalize";

/**
 * A person's full searchable name-term set: display name, structured parts,
 * organization, and the combined "first last" — deduped and lowercased so
 * name-search callers (the imsg Identity Mirror) can match a person by ANY
 * name they've ever gone by, not just their current display_name. Blank
 * fields are omitted; a person with only a display_name still gets one term.
 */
function nameTerms(p: Doc<"people">): string[] {
  const candidates = [
    p.display_name,
    p.first_name,
    p.last_name,
    p.nickname,
    p.organization,
    p.first_name && p.last_name ? `${p.first_name} ${p.last_name}` : undefined,
  ];
  const terms = new Set<string>();
  for (const candidate of candidates) {
    const trimmed = candidate?.trim().toLowerCase();
    if (trimmed) terms.add(trimmed);
  }
  return [...terms];
}

/**
 * Resolve a raw phone / email / handle to the person it belongs to, with all of
 * that person's known identities. This is the "who is this number, and where
 * else do I talk to them" lookup.
 */
export const whoIs = query({
  args: { key: v.string(), handle: v.string() },
  handler: async (ctx, { key, handle }) => {
    requireIdentityKey(key);
    const normalized = normalizePhone(handle) || normalizeEmail(handle) || handle.trim();
    // Multiple identity rows can share a normalized key (different
    // networks/sources feeding the same person, or an as-yet-unresolved row
    // sitting alongside an already-resolved one) — .first() would pick
    // whichever happens to sort first in the index and could report
    // not-found even though a later row does have a person_id. Collect all
    // of them and use the first one that's actually resolved.
    const rows = await ctx.db
      .query("identities")
      .withIndex("by_normalized", (q) => q.eq("normalized", normalized))
      .collect();
    const match = rows.find((r) => r.person_id);
    if (!match || !match.person_id) {
      return { found: false as const, normalized };
    }
    const person = await ctx.db.get(match.person_id);
    if (!person) return { found: false as const, normalized };
    const identities = await ctx.db
      .query("identities")
      .withIndex("by_person", (q) => q.eq("person_id", person._id))
      .collect();
    return {
      found: true as const,
      normalized,
      person,
      identities: identities.map((i) => ({
        kind: i.kind,
        network: i.network,
        source: i.source,
        value: i.value,
        normalized: i.normalized,
        display_name: i.display_name,
        chat_count: i.chat_count,
      })),
    };
  },
});

/** Find people by (case-insensitive substring) display name, with their identities. */
export const searchPeople = query({
  args: { key: v.string(), name: v.string() },
  handler: async (ctx, { key, name }) => {
    requireIdentityKey(key);
    const needle = name.trim().toLowerCase();
    const people = await ctx.db.query("people").collect();
    const matches = people.filter(
      (p) => !p.merged_into && (p.display_name ?? "").toLowerCase().includes(needle),
    );
    const out = [];
    for (const p of matches) {
      const identities = await ctx.db
        .query("identities")
        .withIndex("by_person", (q) => q.eq("person_id", p._id))
        .collect();
      out.push({
        _id: p._id,
        display_name: p.display_name,
        identity_count: p.identity_count,
        normalized_phones: p.normalized_phones,
        normalized_emails: p.normalized_emails,
        identities: identities.map((i) => ({
          kind: i.kind,
          network: i.network,
          value: i.value,
          normalized: i.normalized,
          display_name: i.display_name,
          chat_count: i.chat_count,
        })),
      });
    }
    return out;
  },
});

/**
 * Every named person, sorted for an alphabetically-sectioned contacts list
 * (imsg's browse-all-contacts screen). Unnamed people (a raw handle with no
 * resolvable name from any source) are excluded — nothing useful to show in
 * a name-sorted list. is_self is excluded too; you don't need yourself in
 * your own contacts.
 */
export const listPeople = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    requireIdentityKey(key);
    const people = await ctx.db.query("people").collect();
    return people
      .filter((p) => !p.merged_into && !p.is_self && p.display_name)
      .sort((a, b) => (a.display_name ?? "").localeCompare(b.display_name ?? ""))
      .map((p) => ({
        _id: p._id,
        display_name: p.display_name,
        first_name: p.first_name,
        last_name: p.last_name,
        nickname: p.nickname,
        organization: p.organization,
        normalized_phones: p.normalized_phones,
        normalized_emails: p.normalized_emails,
        airtable_human_id: p.airtable_human_id,
      }));
  },
});

/**
 * Lean {normalized, display_name, terms} projection for imsg's server-side
 * identity mirror (apps/imsg/server/identity-mirror.ts) — a read replica the
 * server refreshes on an interval so the hot chat-list path never blocks on
 * Convex. One entry per normalized handle, flattened across a person's
 * normalized_phones and normalized_emails, for every person that isn't
 * merged away and has a display_name. `is_self` people are included too —
 * harmless to carry Milad's own handles through the mirror, and excluding
 * them isn't worth a special case here (unlike listPeople, which is a
 * human-facing contacts list where it would be confusing).
 *
 * `terms` is the person's FULL searchable name set (see nameTerms) — it's
 * what lets the mirror find someone by an old name after a rename, a
 * nickname, or their organization, not just their current display_name.
 */
export const nameDirectory = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    requireIdentityKey(key);
    const people = await ctx.db.query("people").collect();
    const out: Array<{ normalized: string; display_name: string; terms: string[] }> = [];
    for (const p of people) {
      if (p.merged_into || !p.display_name) continue;
      const terms = nameTerms(p);
      for (const normalized of p.normalized_phones) out.push({ normalized, display_name: p.display_name, terms });
      for (const normalized of p.normalized_emails) out.push({ normalized, display_name: p.display_name, terms });
    }
    return out;
  },
});

/** The people with the most linked identities — the merge graph's payoff. */
export const topLinkedPeople = query({
  args: { key: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { key, limit }) => {
    requireIdentityKey(key);
    const people = await ctx.db.query("people").collect();
    return people
      .filter((p) => !p.merged_into && p.identity_count > 1)
      .sort((a, b) => b.identity_count - a.identity_count)
      .slice(0, limit ?? 25)
      .map((p) => ({
        _id: p._id,
        display_name: p.display_name,
        identity_count: p.identity_count,
        normalized_phones: p.normalized_phones,
        normalized_emails: p.normalized_emails,
        is_self: p.is_self,
      }));
  },
});
