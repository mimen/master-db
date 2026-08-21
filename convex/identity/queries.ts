import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";

import { requireIdentityKey } from "./key";
import { normalizeEmail, normalizePhone } from "./normalize";

/** A single event association, projected for the client — see
 * schema/identity/event_links.ts's docstring for the storage shape.
 * `linkId` is the event_links row's own document id, NOT the Airtable
 * record id (`id`) — it's what an editable CRM surface needs to call
 * `events.ts`'s `unlinkEvent({ linkId })`. Convex-facing projections
 * (whoIs/listPeople/chatCrm, consumed directly by the client's editable CRM
 * sections) include it; imsg's server-side Identity Mirror and the
 * READ-ONLY ChatSummary.crm it feeds deliberately do NOT carry it further —
 * see apps/imsg/server/name-resolver.ts's CrmData and shared/types.ts's
 * ChatSummary.crm, which only ever display, never edit. */
type EventRef = { id: string; name: string; linkId: Id<"event_links"> };

/** A person's personal tags, alphabetized — the unified `tags` table (see
 * schema/identity/tags.ts) lives separately from the person doc, so unlike
 * is_favorite/priority (plain fields on the person doc) it needs its own
 * lookup at every call site that projects a person for the client. */
async function personTagsFor(ctx: QueryCtx, personId: Id<"people">): Promise<string[]> {
  const rows = await ctx.db
    .query("tags")
    .withIndex("by_person", (q) => q.eq("person_id", personId))
    .collect();
  return rows.map((r) => r.tag).sort();
}

/** A GROUP chat's tags, alphabetized — the chat-side twin of personTagsFor. */
async function chatTagsFor(ctx: QueryCtx, chatGuid: string): Promise<string[]> {
  const rows = await ctx.db
    .query("tags")
    .withIndex("by_chat", (q) => q.eq("chat_guid", chatGuid))
    .collect();
  return rows.map((r) => r.tag).sort();
}

/** A person's linked events — see schema/identity/event_links.ts. */
async function personEventsFor(ctx: QueryCtx, personId: Id<"people">): Promise<EventRef[]> {
  const rows = await ctx.db
    .query("event_links")
    .withIndex("by_person", (q) => q.eq("person_id", personId))
    .collect();
  return rows.map((r) => ({ id: r.airtable_event_id, name: r.event_name, linkId: r._id }));
}

/** A GROUP chat's linked events — the chat-side twin of personEventsFor. */
async function chatEventsFor(ctx: QueryCtx, chatGuid: string): Promise<EventRef[]> {
  const rows = await ctx.db
    .query("event_links")
    .withIndex("by_chat", (q) => q.eq("chat_guid", chatGuid))
    .collect();
  return rows.map((r) => ({ id: r.airtable_event_id, name: r.event_name, linkId: r._id }));
}

/**
 * EVERY person's tags and event links, each table read exactly once and
 * grouped by person — the whole-table twin of personTagsFor/personEventsFor.
 * The per-person helpers are an indexed lookup per person per call site;
 * whole-directory queries (listPeople/nameDirectory) that loop them over
 * every person turn that into an N+1 whose read count grows with the people
 * table until Convex kills the query for "too many system operations". These
 * tables hold only rows someone actually annotated, so a full scan is cheap
 * and flat regardless of how many people exist.
 */
async function personCrmMaps(ctx: QueryCtx): Promise<{
  tagsByPerson: Map<Id<"people">, string[]>;
  eventsByPerson: Map<Id<"people">, EventRef[]>;
}> {
  const tagsByPerson = new Map<Id<"people">, string[]>();
  for (const row of await ctx.db.query("tags").collect()) {
    if (!row.person_id) continue;
    const list = tagsByPerson.get(row.person_id);
    if (list) list.push(row.tag);
    else tagsByPerson.set(row.person_id, [row.tag]);
  }
  for (const list of tagsByPerson.values()) list.sort();

  const eventsByPerson = new Map<Id<"people">, EventRef[]>();
  for (const row of await ctx.db.query("event_links").collect()) {
    if (!row.person_id) continue;
    const ref: EventRef = { id: row.airtable_event_id, name: row.event_name, linkId: row._id };
    const list = eventsByPerson.get(row.person_id);
    if (list) list.push(ref);
    else eventsByPerson.set(row.person_id, [ref]);
  }
  return { tagsByPerson, eventsByPerson };
}

/** Reads a (possibly still-transitional-string) priority as the numeric P1–P5
 * form only — see schema/identity/people.ts's docstring on the transitional
 * union type. A row that hasn't been through `migratePriorityToNumeric` yet
 * still holds "high"/"normal"/"low"; every CLIENT-facing projection should
 * see that as "no numeric priority yet" rather than leak the string through,
 * so downstream (imsg's ChatSummary.crm.priority: number) never has to
 * special-case a non-numeric value. */
function numericPriority(p: Doc<"people">["priority"]): number | undefined {
  return typeof p === "number" ? p : undefined;
}

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
    const tags = await personTagsFor(ctx, person._id);
    const events = await personEventsFor(ctx, person._id);
    return {
      found: true as const,
      normalized,
      // `person` is the raw Doc<"people">, so is_favorite/priority already
      // ride along automatically — only `tags`/`events` need to be joined in
      // separately (private CRM layer, see convex/identity/crm.ts).
      person,
      tags,
      events,
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
    const named = people
      .filter((p) => !p.merged_into && !p.is_self && p.display_name)
      .sort((a, b) => (a.display_name ?? "").localeCompare(b.display_name ?? ""));
    // Single pass per table — see personCrmMaps. The per-person lookups this
    // replaces timed out once the people table grew past Convex's operation
    // budget ("too many system operations"), white-screening every client.
    const { tagsByPerson, eventsByPerson } = await personCrmMaps(ctx);
    const out = [];
    for (const p of named) {
      out.push({
        _id: p._id,
        display_name: p.display_name,
        first_name: p.first_name,
        last_name: p.last_name,
        nickname: p.nickname,
        organization: p.organization,
        normalized_phones: p.normalized_phones,
        normalized_emails: p.normalized_emails,
        airtable_human_id: p.airtable_human_id,
        is_favorite: p.is_favorite,
        priority: numericPriority(p.priority),
        tags: tagsByPerson.get(p._id) ?? [],
        events: eventsByPerson.get(p._id) ?? [],
      });
    }
    return out;
  },
});

/**
 * Lean {normalized, display_name, terms, crm} projection for imsg's
 * server-side identity mirror (apps/imsg/server/identity-mirror.ts) — a read
 * replica the server refreshes on an interval so the hot chat-list path
 * never blocks on Convex. One entry per normalized handle, flattened across
 * a person's normalized_phones and normalized_emails, for every person that
 * isn't merged away and has a display_name. `is_self` people are included too
 * — harmless to carry Milad's own handles through the mirror, and excluding
 * them isn't worth a special case here (unlike listPeople, which is a
 * human-facing contacts list where it would be confusing).
 *
 * `terms` is the person's FULL searchable name set (see nameTerms) — it's
 * what lets the mirror find someone by an old name after a rename, a
 * nickname, or their organization, not just their current display_name.
 *
 * `crm` is the person's private CRM projection (favorite/priority/tags/
 * events) — it's how a DM's ChatSummary.crm gets populated by INHERITANCE
 * from its one participant's person (see apps/imsg/server/map.ts's mapChat):
 * the mirror already resolves a participant address → this entry, so riding
 * the person's CRM along here means map.ts doesn't need a second lookup.
 */
export const nameDirectory = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    requireIdentityKey(key);
    const people = await ctx.db.query("people").collect();
    // Single pass per table — see personCrmMaps (same N+1 listPeople hit).
    const { tagsByPerson, eventsByPerson } = await personCrmMaps(ctx);
    const out: Array<{
      normalized: string;
      display_name: string;
      terms: string[];
      crm: { is_favorite?: boolean; priority?: number; tags: string[]; events: EventRef[] };
    }> = [];
    for (const p of people) {
      if (p.merged_into || !p.display_name) continue;
      const terms = nameTerms(p);
      const crm = {
        is_favorite: p.is_favorite,
        priority: numericPriority(p.priority),
        tags: tagsByPerson.get(p._id) ?? [],
        events: eventsByPerson.get(p._id) ?? [],
      };
      for (const normalized of p.normalized_phones) out.push({ normalized, display_name: p.display_name, terms, crm });
      for (const normalized of p.normalized_emails) out.push({ normalized, display_name: p.display_name, terms, crm });
    }
    return out;
  },
});

/**
 * Every distinct tag in use, with how many (people + GROUP chats combined)
 * carry it — for a unified browse/filter-by-tag surface across both entity
 * kinds. The `tags` table (schema/identity/tags.ts) already unifies person
 * and chat rows, so counting is a single pass with no kind-branching needed.
 * Personal/chat tags only (the private CRM layer, convex/identity/crm.ts);
 * Airtable's organizational tags (UW Team, departments) are a separate,
 * deferred read-only pass-through that doesn't exist yet — see
 * person_tags.ts's docstring.
 */
export const listTags = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    requireIdentityKey(key);
    const rows = await ctx.db.query("tags").collect();
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.tag, (counts.get(r.tag) ?? 0) + 1);
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
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

/**
 * Per-chat-guid CRM projection {is_favorite?, priority?, tags, events} for a
 * batch of GROUP chats — imsg's server fetches this alongside `nameDirectory`
 * to populate its Identity Mirror's chat-CRM accessor (see
 * apps/imsg/server/identity-mirror.ts). `chatGuids` is optional: omitted, this
 * returns every chat_guid that carries ANY CRM data (favorite, priority, tag,
 * or event link) — the table is naturally small (only chats someone has
 * actually annotated get a row/tag/link at all), so "give me everything" is
 * cheap and is what the mirror's periodic refresh uses, since it has no
 * independent way to know which chat guids currently exist (that's
 * BlueBubbles/ChatDirectory's domain, not Convex's). Passing an explicit list
 * scopes the result to just those guids, for a future targeted lookup (e.g.
 * a single open chat's info screen).
 */
export const chatCrm = query({
  args: { key: v.string(), chatGuids: v.optional(v.array(v.string())) },
  handler: async (ctx, { key, chatGuids }) => {
    requireIdentityKey(key);
    const wanted = chatGuids ? new Set(chatGuids) : null;

    type ChatCrmProjection = { is_favorite?: boolean; priority?: number; tags: string[]; events: EventRef[] };
    const out: Record<string, ChatCrmProjection> = {};
    const ensure = (guid: string): ChatCrmProjection => {
      const existing = out[guid];
      if (existing) return existing;
      const fresh: ChatCrmProjection = { tags: [], events: [] };
      out[guid] = fresh;
      return fresh;
    };

    const crmRows = await ctx.db.query("chat_crm").collect();
    for (const row of crmRows) {
      if (wanted && !wanted.has(row.chat_guid)) continue;
      const entry = ensure(row.chat_guid);
      entry.is_favorite = row.is_favorite;
      entry.priority = row.priority;
    }

    const tagRows = await ctx.db.query("tags").collect();
    for (const row of tagRows) {
      if (!row.chat_guid) continue;
      if (wanted && !wanted.has(row.chat_guid)) continue;
      ensure(row.chat_guid).tags.push(row.tag);
    }

    const eventRows = await ctx.db.query("event_links").collect();
    for (const row of eventRows) {
      if (!row.chat_guid) continue;
      if (wanted && !wanted.has(row.chat_guid)) continue;
      ensure(row.chat_guid).events.push({ id: row.airtable_event_id, name: row.event_name, linkId: row._id });
    }

    for (const entry of Object.values(out)) entry.tags.sort();
    return out;
  },
});

// Chat-side helpers exported for reuse elsewhere in the module if a future
// per-chat query needs them individually rather than the batch above.
export { chatEventsFor, chatTagsFor };
