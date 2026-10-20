import { v } from "convex/values";

import { action } from "../_generated/server";

import { requireIdentityAccess } from "./key";

/**
 * Milad's own AUF guest lists, for Comma's quick add. Guest rows live in AUF's
 * Convex, not Airtable, and Prism's capability route reads and writes them
 * while enforcing the owner's comp budget and deadline. Milad's list is
 * uncapped, so an add first tops up his own General Admission allocation in
 * Airtable, the same record Backstage writes when staff grant comps.
 */

const AIRTABLE_BASE_ID = "app39VsA3z85GTMbT";
const EVENTS_TABLE_ID = "tblMUAZPSnj9al2AC";
const GUEST_ALLOCATIONS_TABLE_ID = "tblM4CWNiCpKUANho";
const PRISM_ORIGIN = "https://afternoonumbrellafriends.com";
/** Milad's Humans record: the owner whose comp allocation the quick add spends. */
const OWNER_HUMAN_ID = "rec6tdemsHYMY3X80";
/** AUF's global General Admission tier, valid on every event. */
const GA_TIER_ID = "recJzhaWLggd36A9Z";
const RECORD_ID = /^rec[A-Za-z0-9]+$/;

/** Prism's comps window: from yesterday on, minus events that are not happening. */
const UPCOMING_FORMULA =
  "AND({Name}!='', {Start Date}!='', IS_AFTER({Start Date}, DATEADD(TODAY(),-1,'days')), " +
  "{Event Status}!='Cancelled', {Event Status}!='Postponed')";

export type GuestListEvent = {
  eventId: string;
  name: string;
  startDate: string;
  deadline: string | null;
  /** Lowercased emails already on Milad's list for this event. */
  guestEmails: string[];
};

export type GuestAddResult =
  | { outcome: "confirmed" }
  | { outcome: "rejected"; reason: string }
  | { outcome: "unconfirmed" };

type AirtableEventRecord = { id: string; fields: { Name?: string; "Start Date"?: string } };

type PrismGuestList = {
  view: { rows: { contact: { email: string } }[] };
  deadline: string | null;
  allocations: { ticketTierId: string; remaining: number }[];
};

function guestListUrl(eventId: string): string {
  return `${PRISM_ORIGIN}/api/events/${eventId}/guest-list?ownerType=human&ownerId=${OWNER_HUMAN_ID}`;
}

function airtableUrl(table: string, params?: URLSearchParams): string {
  return `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${table}${params ? `?${params.toString()}` : ""}`;
}

function airtableKey(): string {
  const apiKey = process.env.AIRTABLE_API_KEY;
  if (!apiKey) throw new Error("AIRTABLE_API_KEY not configured on this Convex deployment");
  return apiKey;
}

async function readGuestList(eventId: string): Promise<PrismGuestList> {
  const res = await fetch(guestListUrl(eventId));
  if (!res.ok) throw new Error(`Guest list read failed: ${res.status}`);
  return (await res.json()) as PrismGuestList;
}

export function toGuestListEvent(event: AirtableEventRecord, list: PrismGuestList): GuestListEvent | null {
  if (!event.fields.Name || !event.fields["Start Date"]) return null;
  return {
    eventId: event.id,
    name: event.fields.Name,
    startDate: event.fields["Start Date"],
    deadline: list.deadline,
    guestEmails: list.view.rows.map((r) => r.contact.email.toLowerCase()),
  };
}

/** Raises Milad's own GA allocation on the event until it has a free spot, creating the row when he has none. */
async function ensureSpot(eventId: string): Promise<void> {
  const list = await readGuestList(eventId);
  const remaining = list.allocations.filter((a) => a.ticketTierId === GA_TIER_ID).reduce((sum, a) => sum + a.remaining, 0);
  const shortfall = 1 - remaining;
  if (shortfall <= 0) return;

  const headers = { Authorization: `Bearer ${airtableKey()}`, "Content-Type": "application/json" };
  const params = new URLSearchParams({
    filterByFormula: `AND(FIND('${eventId}', ARRAYJOIN({Event ID})), FIND('${OWNER_HUMAN_ID}', ARRAYJOIN({Human ID})), FIND('${GA_TIER_ID}', ARRAYJOIN({Ticket Tier ID})), NOT({Booking}))`,
    "fields[]": "Count",
  });
  const found = await fetch(airtableUrl(GUEST_ALLOCATIONS_TABLE_ID, params), { headers });
  if (!found.ok) throw new Error(`Guest Allocations read failed: ${found.status} ${await found.text()}`);
  const [row] = ((await found.json()) as { records: { id: string; fields: { Count?: number } }[] }).records;

  const write = row
    ? fetch(airtableUrl(GUEST_ALLOCATIONS_TABLE_ID), {
        method: "PATCH",
        headers,
        body: JSON.stringify({ records: [{ id: row.id, fields: { Count: (row.fields.Count ?? 0) + shortfall } }] }),
      })
    : fetch(airtableUrl(GUEST_ALLOCATIONS_TABLE_ID), {
        method: "POST",
        headers,
        body: JSON.stringify({
          records: [{ fields: { Event: [eventId], Human: [OWNER_HUMAN_ID], "Ticket Tier": [GA_TIER_ID], Count: shortfall, Reason: "Comma quick add" } }],
        }),
      });
  const res = await write;
  if (!res.ok) throw new Error(`Guest Allocations write failed: ${res.status} ${await res.text()}`);
}

export const upcomingGuestLists = action({
  args: { key: v.optional(v.string()) },
  handler: async (ctx, { key }): Promise<GuestListEvent[]> => {
    await requireIdentityAccess(ctx, key);
    const params = new URLSearchParams({ filterByFormula: UPCOMING_FORMULA, "sort[0][field]": "Start Date" });
    for (const f of ["Name", "Start Date"]) params.append("fields[]", f);
    const res = await fetch(airtableUrl(EVENTS_TABLE_ID, params), { headers: { Authorization: `Bearer ${airtableKey()}` } });
    if (!res.ok) throw new Error(`Airtable upcoming events failed: ${res.status} ${await res.text()}`);
    const { records } = (await res.json()) as { records: AirtableEventRecord[] };

    const lists = await Promise.all(
      records.map(async (event) => {
        const list = await fetch(guestListUrl(event.id));
        return list.ok ? toGuestListEvent(event, (await list.json()) as PrismGuestList) : null;
      }),
    );
    return lists.filter((l): l is GuestListEvent => l !== null);
  },
});

/** Adds one General Admission guest to Milad's list. A 202 means Prism may have
 * written the row, so it is retried with the same commandId, which Prism dedupes. */
export const addToGuestList = action({
  args: {
    key: v.optional(v.string()),
    eventId: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    email: v.string(),
  },
  handler: async (ctx, { key, eventId, firstName, lastName, email }): Promise<GuestAddResult> => {
    await requireIdentityAccess(ctx, key);
    if (!RECORD_ID.test(eventId)) return { outcome: "rejected", reason: "Unknown event" };
    await ensureSpot(eventId);

    const body = JSON.stringify({
      kind: "add",
      commandId: crypto.randomUUID(),
      tierId: GA_TIER_ID,
      contact: { firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim() },
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(guestListUrl(eventId), { method: "POST", headers: { "Content-Type": "application/json" }, body });
      const result = (await res.json().catch(() => ({}))) as { outcome?: string; reason?: string };
      if (result.outcome === "confirmed") return { outcome: "confirmed" };
      if (res.status !== 202) return { outcome: "rejected", reason: result.reason ?? `Guest list returned ${res.status}` };
    }
    return { outcome: "unconfirmed" };
  },
});
