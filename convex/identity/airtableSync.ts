import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";

/**
 * Pulls AUF's Airtable "Humans" table into the identity graph, Convex-native
 * (no imsg involvement — unlike Apple Contacts, Airtable has a real cloud
 * API, so this runs the same way convex/todoist/sync does: a scheduled
 * action calling fetch() directly). Cron-driven, full refresh each run —
 * the table is small enough that incremental sync isn't worth the
 * complexity Todoist's sync token approach needs.
 *
 * Deliberately excludes Profile Picture: Airtable attachment URLs are
 * signed and expire, so storing one would rot. imsg already sources photos
 * from Apple Contacts via its own avatar route — nothing reads a photo out
 * of the identity graph, same reasoning as dropping Apple's avatar bytes.
 *
 * link_only: this background sync only ENRICHES people already in the
 * graph (exact phone/email match) — it never creates a new person from an
 * unmatched Humans record. Airtable is a growing community database, most
 * of which Milad has never actually talked to; this cron isn't the place to
 * decide those people belong in his identity graph. Bringing a specific
 * unmatched person in on purpose is airtableSearch.ts's job.
 */

const AIRTABLE_BASE_ID = "app39VsA3z85GTMbT";
const HUMANS_TABLE_ID = "tbl6LptFEMKLaN0I9";
// Every phone/email column on Humans, not just the first of each — these are
// JOIN KEYS (see toContactCard), not just enrichment data. A person whose
// Apple contact only carries their 2nd/3rd phone or 3rd/4th email would never
// link to their Airtable record if we only pulled the first of each.
// Deliberately excludes "PayPal Email" and "Shotgun Email Address" — those are
// payment/vendor addresses, not identity handles a human would recognize as
// "their email."
const FIELDS = [
  "Name",
  "First Name",
  "Last Name",
  "Phone Number",
  "Phone Number 2",
  "Phone Number 3",
  "Email Address",
  "Email Address 2",
  "Email Address 3",
  "Email Address 4",
];

type AirtableRecord = {
  id: string;
  fields: {
    Name?: string;
    "First Name"?: string;
    "Last Name"?: string;
    "Phone Number"?: string;
    "Phone Number 2"?: string;
    "Phone Number 3"?: string;
    "Email Address"?: string;
    "Email Address 2"?: string;
    "Email Address 3"?: string;
    "Email Address 4"?: string;
  };
};

type AirtableListResponse = {
  records: AirtableRecord[];
  offset?: string;
};

type ContactCard = {
  display_name?: string;
  // First/Last Name are separate singleLineText columns in Airtable Humans —
  // see convex/schema/identity/identities.ts's docstring: these can be naive
  // or empty even when Name is a good display value (freeform rows like "The
  // Brooklyn Mirage" or "@nataliekowal_" have no real first/last). No
  // nickname/organization column exists in Humans, so those stay unset from
  // this source (Apple Contacts is the only source for nickname; Convex
  // itself is the source for organization).
  first_name?: string;
  last_name?: string;
  phones: string[];
  emails: string[];
  airtable_record_id: string;
};

/** Maps one Humans row to a pre-grouped contact card, or null if it has no handle at all. */
export function toContactCard(r: AirtableRecord): ContactCard | null {
  const phones = [r.fields["Phone Number"], r.fields["Phone Number 2"], r.fields["Phone Number 3"]].filter(
    (p): p is string => Boolean(p),
  );
  const emails = [
    r.fields["Email Address"],
    r.fields["Email Address 2"],
    r.fields["Email Address 3"],
    r.fields["Email Address 4"],
  ].filter((e): e is string => Boolean(e));
  if (phones.length === 0 && emails.length === 0) return null;
  return {
    display_name: r.fields.Name,
    first_name: r.fields["First Name"],
    last_name: r.fields["Last Name"],
    phones,
    emails,
    airtable_record_id: r.id,
  };
}

export const syncAirtableHumans = internalAction({
  args: {},
  handler: async (ctx) => {
    const apiKey = process.env.AIRTABLE_API_KEY;
    if (!apiKey) {
      throw new Error("AIRTABLE_API_KEY not configured on this Convex deployment");
    }

    const contacts: ContactCard[] = [];

    let offset: string | undefined;
    let pages = 0;
    do {
      const params = new URLSearchParams({ pageSize: "100" });
      for (const f of FIELDS) params.append("fields[]", f);
      if (offset) params.set("offset", offset);

      const res = await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${HUMANS_TABLE_ID}?${params.toString()}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );
      if (!res.ok) {
        throw new Error(`Airtable Humans fetch failed: ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as AirtableListResponse;
      for (const r of body.records) {
        const card = toContactCard(r);
        if (card) contacts.push(card);
      }
      offset = body.offset;
      pages++;
    } while (offset && pages < 100); // safety cap, Humans is nowhere near 10k records

    // link_only: Airtable should enrich people Milad already has (via
    // exact phone/email match against existing Apple/Beeper identities),
    // never seed the graph with everyone in a growing community database
    // he's never actually talked to. Records with no existing match are
    // skipped here — they're still reachable on demand via
    // identity/airtableSearch.ts's live "Add Contact from Airtable" search.
    let peopleReused = 0;
    let identitiesWritten = 0;
    let skippedNoMatch = 0;
    for (let i = 0; i < contacts.length; i += 50) {
      const slice = contacts.slice(i, i + 50);
      const result = await ctx.runMutation(internal.identity.ingestContacts.ingestContactsBatch, {
        source: "airtable_human",
        contacts: slice,
        link_only: true,
      });
      peopleReused += result.peopleReused;
      identitiesWritten += result.identitiesWritten;
      skippedNoMatch += result.skippedNoMatch;
    }

    return { recordsSeen: contacts.length, peopleReused, identitiesWritten, skippedNoMatch };
  },
});
