import { v } from "convex/values";

import { query } from "../_generated/server";

import { normalizeEmail, normalizePhone } from "./normalize";

/**
 * Resolve a raw phone / email / handle to the person it belongs to, with all of
 * that person's known identities. This is the "who is this number, and where
 * else do I talk to them" lookup.
 */
export const whoIs = query({
  args: { handle: v.string() },
  handler: async (ctx, { handle }) => {
    const normalized = normalizePhone(handle) || normalizeEmail(handle) || handle.trim();
    const match = await ctx.db
      .query("identities")
      .withIndex("by_normalized", (q) => q.eq("normalized", normalized))
      .first();
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
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
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
  args: {},
  handler: async (ctx) => {
    const people = await ctx.db.query("people").collect();
    return people
      .filter((p) => !p.merged_into && !p.is_self && p.display_name)
      .sort((a, b) => (a.display_name ?? "").localeCompare(b.display_name ?? ""))
      .map((p) => ({
        _id: p._id,
        display_name: p.display_name,
        normalized_phones: p.normalized_phones,
        normalized_emails: p.normalized_emails,
      }));
  },
});

/** The people with the most linked identities — the merge graph's payoff. */
export const topLinkedPeople = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
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
