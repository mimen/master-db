import { v } from "convex/values";

import { action } from "../_generated/server";

import { requireIdentityAccess } from "./key";

/**
 * Milad's own AUF guest lists, for Comma's quick add. Guest rows live in AUF's
 * Convex, not Airtable, and Prism's capability route reads and writes them
 * while enforcing the owner's comp budgets and deadline. This file only finds
 * upcoming events in Airtable and relays reads and adds to that route.
 */

const AIRTABLE_BASE_ID = "app39VsA3z85GTMbT";
const EVENTS_TABLE_ID = "tblMUAZPSnj9al2AC";
const PRISM_ORIGIN = "https://afternoonumbrellafriends.com";
/** Milad's Humans record: the owner whose comp allocations the quick add spends. */
const OWNER_HUMAN_ID = "rec6tdemsHYMY3X80";
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
  tiers: { tierId: string; tierName: string; remaining: number }[];
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
  allocations: { ticketTierId: string; ticketTierName: string; count: number; remaining: number }[];
};

function guestListUrl(eventId: string): string {
  return `${PRISM_ORIGIN}/api/events/${eventId}/guest-list?ownerType=human&ownerId=${OWNER_HUMAN_ID}`;
}

/** Null when Milad holds no allocation for the event, so it has nothing to add to. */
export function toGuestListEvent(event: AirtableEventRecord, list: PrismGuestList): GuestListEvent | null {
  const tiers = list.allocations
    .filter((a) => a.count > 0)
    .map((a) => ({ tierId: a.ticketTierId, tierName: a.ticketTierName, remaining: a.remaining }));
  if (tiers.length === 0 || !event.fields.Name || !event.fields["Start Date"]) return null;
  return {
    eventId: event.id,
    name: event.fields.Name,
    startDate: event.fields["Start Date"],
    deadline: list.deadline,
    tiers,
    guestEmails: list.view.rows.map((r) => r.contact.email.toLowerCase()),
  };
}

export const upcomingGuestLists = action({
  args: { key: v.optional(v.string()) },
  handler: async (ctx, { key }): Promise<GuestListEvent[]> => {
    await requireIdentityAccess(ctx, key);
    const apiKey = process.env.AIRTABLE_API_KEY;
    if (!apiKey) throw new Error("AIRTABLE_API_KEY not configured on this Convex deployment");

    const params = new URLSearchParams({ filterByFormula: UPCOMING_FORMULA, "sort[0][field]": "Start Date" });
    for (const f of ["Name", "Start Date"]) params.append("fields[]", f);
    const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${EVENTS_TABLE_ID}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
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

/** Adds one guest to Milad's list. A 202 means Prism may have written the row,
 * so it is retried with the same commandId, which Prism dedupes. */
export const addToGuestList = action({
  args: {
    key: v.optional(v.string()),
    eventId: v.string(),
    tierId: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    email: v.string(),
  },
  handler: async (ctx, { key, eventId, tierId, firstName, lastName, email }): Promise<GuestAddResult> => {
    await requireIdentityAccess(ctx, key);
    if (!RECORD_ID.test(eventId) || !RECORD_ID.test(tierId)) return { outcome: "rejected", reason: "Unknown event or tier" };

    const body = JSON.stringify({
      kind: "add",
      commandId: crypto.randomUUID(),
      tierId,
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
