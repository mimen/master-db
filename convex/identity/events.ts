import { v } from "convex/values";

import { action, mutation } from "../_generated/server";

import { aufIdentityQuery } from "./aufConvex";
import { groupConversation, groupCrm, groupOwner } from "./groupCrm";
import { requireIdentityAccess } from "./key";

/**
 * Typed event/project association: search AUF's Events and
 * link/unlink a person or GROUP chat to a specific event record — see
 * schema/identity/event_links.ts's docstring for the storage shape and why
 * `event_name` is denormalized. Sibling to airtableSearch.ts (same
 * live-search-not-ingested approach) and crm.ts (same link/unlink
 * mutation shape as the tag mutations), just for Events.
 */

/** Live search of AUF's Events (AUF `commaIdentity:searchEvents`, at most 15), for the event-link picker on
 * a person's or GROUP chat's CRM section. Not cached/ingested — same
 * reasoning as airtableSearch.ts's searchAirtableHumans: searched live each
 * call, capped, cheap enough for an on-demand picker. */
export const searchEvents = action({
  args: { key: v.optional(v.string()), query: v.string() },
  handler: async (ctx, { key, query }) => {
    await requireIdentityAccess(ctx, key);
    const needle = query.trim();
    if (needle.length < 2) return [];

    const events = await aufIdentityQuery<{ id: string; name: string; startDate?: string }[]>("searchEvents", { query: needle });
    return events.map((e) => ({ record_id: e.id, name: e.name, start_date: e.startDate }));
  },
});

/**
 * Link a person or GROUP chat to an Airtable event — exactly one of
 * personId/conversationId/chatGuid must be set (see event_links.ts's docstring). Dedupes
 * against an existing link to the SAME event for the SAME owner (no-op write,
 * but refreshes the cached `event_name` if the event was renamed in Airtable
 * since the original link — same "cache can drift, re-linking refreshes it"
 * contract the schema docstring promises).
 */
export const linkEvent = mutation({
  args: {
    key: v.optional(v.string()),
    personId: v.optional(v.id("people")),
    conversationId: v.optional(v.id("comma_conversations")),
    chatGuid: v.optional(v.string()),
    airtable_event_id: v.string(),
    event_name: v.string(),
    start_date: v.optional(v.string()),
  },
  handler: async (ctx, { key, personId, conversationId, chatGuid, airtable_event_id, event_name, start_date }) => {
    await requireIdentityAccess(ctx, key);
    if ([personId, conversationId, chatGuid].filter((x) => x !== undefined).length !== 1) {
      throw new Error("linkEvent requires exactly one of personId, conversationId or chatGuid");
    }

    const group = personId ? null : await groupConversation(ctx, { conversationId, chatGuid });
    const existing = group
      ? await groupCrm.events(ctx, group)
      : await ctx.db.query("event_links").withIndex("by_person", (q) => q.eq("person_id", personId)).collect();
    const match = existing.find((e) => e.airtable_event_id === airtable_event_id);
    if (match) {
      if (match.event_name !== event_name || (start_date && match.start_date !== start_date)) {
        await ctx.db.patch(match._id, { event_name, ...(start_date ? { start_date } : {}) });
      }
      return { linkId: match._id };
    }

    const linkId = await ctx.db.insert("event_links", {
      ...(group ? groupOwner(group) : { person_id: personId }),
      airtable_event_id,
      event_name,
      start_date,
      created_at: new Date().toISOString(),
    });
    return { linkId };
  },
});

/** Remove an event link by id. No-op when it's already gone (double-tap
 * safe), same discipline as crm.ts's removeTag. */
export const unlinkEvent = mutation({
  args: { key: v.optional(v.string()), linkId: v.id("event_links") },
  handler: async (ctx, { key, linkId }) => {
    await requireIdentityAccess(ctx, key);
    const existing = await ctx.db.get(linkId);
    if (!existing) return;
    await ctx.db.delete(linkId);
  },
});
