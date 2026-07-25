import { v } from "convex/values";

import { action, mutation } from "../_generated/server";

import { airtableNameSearchFormula } from "./airtableSearch";
import { requireIdentityKey } from "./key";

/**
 * Typed event/project association: search AUF's Airtable Events table and
 * link/unlink a person or GROUP chat to a specific event record — see
 * schema/identity/event_links.ts's docstring for the storage shape and why
 * `event_name` is denormalized. Sibling to airtableSearch.ts (same base,
 * same live-search-not-ingested approach) and crm.ts (same link/unlink
 * mutation shape as the tag mutations), just for a different Airtable table.
 */

const AIRTABLE_BASE_ID = "app39VsA3z85GTMbT";
const EVENTS_TABLE_ID = "tblMUAZPSnj9al2AC";
const RESULTS_LIMIT = 15;

type AirtableEventRecord = {
  id: string;
  fields: {
    Name?: string;
    "Start Date"?: string;
  };
};

/** Live search against Airtable's Events table, for the event-link picker on
 * a person's or GROUP chat's CRM section. Not cached/ingested — same
 * reasoning as airtableSearch.ts's searchAirtableHumans: searched live each
 * call, capped, cheap enough for an on-demand picker. */
export const searchEvents = action({
  args: { key: v.string(), query: v.string() },
  handler: async (_ctx, { key, query }) => {
    requireIdentityKey(key);
    const needle = query.trim();
    if (needle.length < 2) return [];

    const apiKey = process.env.AIRTABLE_API_KEY;
    if (!apiKey) throw new Error("AIRTABLE_API_KEY not configured on this Convex deployment");

    const formula = airtableNameSearchFormula(needle);
    const params = new URLSearchParams({ pageSize: String(RESULTS_LIMIT), filterByFormula: formula });
    for (const f of ["Name", "Start Date"]) params.append("fields[]", f);

    const res = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${EVENTS_TABLE_ID}?${params.toString()}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!res.ok) throw new Error(`Airtable Events search failed: ${res.status} ${await res.text()}`);

    const body = (await res.json()) as { records: AirtableEventRecord[] };
    return body.records
      .map((r) => ({
        record_id: r.id,
        name: r.fields.Name ?? "",
        start_date: r.fields["Start Date"],
      }))
      .filter((r) => r.name)
      .slice(0, RESULTS_LIMIT);
  },
});

/**
 * Link a person or GROUP chat to an Airtable event — exactly one of
 * personId/chatGuid must be set (see event_links.ts's docstring). Dedupes
 * against an existing link to the SAME event for the SAME owner (no-op write,
 * but refreshes the cached `event_name` if the event was renamed in Airtable
 * since the original link — same "cache can drift, re-linking refreshes it"
 * contract the schema docstring promises).
 */
export const linkEvent = mutation({
  args: {
    key: v.string(),
    personId: v.optional(v.id("people")),
    chatGuid: v.optional(v.string()),
    airtable_event_id: v.string(),
    event_name: v.string(),
  },
  handler: async (ctx, { key, personId, chatGuid, airtable_event_id, event_name }) => {
    requireIdentityKey(key);
    if (Boolean(personId) === Boolean(chatGuid)) {
      throw new Error("linkEvent requires exactly one of personId or chatGuid");
    }

    const existing = personId
      ? await ctx.db.query("event_links").withIndex("by_person", (q) => q.eq("person_id", personId)).collect()
      : await ctx.db.query("event_links").withIndex("by_chat", (q) => q.eq("chat_guid", chatGuid)).collect();
    const match = existing.find((e) => e.airtable_event_id === airtable_event_id);
    if (match) {
      if (match.event_name !== event_name) await ctx.db.patch(match._id, { event_name });
      return { linkId: match._id };
    }

    const linkId = await ctx.db.insert("event_links", {
      person_id: personId,
      chat_guid: chatGuid,
      airtable_event_id,
      event_name,
      created_at: new Date().toISOString(),
    });
    return { linkId };
  },
});

/** Remove an event link by id. No-op when it's already gone (double-tap
 * safe), same discipline as crm.ts's removeTag. */
export const unlinkEvent = mutation({
  args: { key: v.string(), linkId: v.id("event_links") },
  handler: async (ctx, { key, linkId }) => {
    requireIdentityKey(key);
    const existing = await ctx.db.get(linkId);
    if (!existing) return;
    await ctx.db.delete(linkId);
  },
});
