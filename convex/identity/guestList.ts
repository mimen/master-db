import { v } from "convex/values";

import { action } from "../_generated/server";

import { aufIdentityQuery, aufToken } from "./aufConvex";
import { requireIdentityAccess } from "./key";

/**
 * Milad's own AUF guest lists, for Comma's quick add. The upcoming events come
 * from AUF's Convex on Comma's identity lane. Guest rows live in AUF's
 * Convex, and Prism's capability route reads and writes them while enforcing
 * the owner's comp budget and deadline. Milad's list is uncapped, so an add
 * first tops up his own General Admission allocation through AUF's Convex,
 * which owns Guest Allocations; a direct Airtable write would be reverted as
 * drift. Until AUF_CONVEX_URL and AUF_COMMA_JWT_PRIVATE_KEY are set, an add
 * with no free spot is refused and the spot is granted in Backstage.
 */

const PRISM_ORIGIN = "https://afternoonumbrellafriends.com";
/** Milad's Humans record: the owner whose comp allocation the quick add spends. */
const OWNER_HUMAN_ID = "rec6tdemsHYMY3X80";
/** AUF's global General Admission tier, valid on every event. */
const GA_TIER_ID = "recJzhaWLggd36A9Z";
const RECORD_ID = /^rec[A-Za-z0-9]+$/;
const NO_SPOT = "No General Admission spot left on your list. Grant one in Backstage.";

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

/** AUF `commaIdentity:upcomingEvents`: Prism's comps window, from yesterday on, minus events that are not happening. */
type UpcomingEvent = { id: string; name: string; startDate: string };

type PrismGuestList = {
  view: { rows: { contact: { email: string } }[] };
  deadline: string | null;
  allocations: { ticketTierId: string; remaining: number }[];
};

function guestListUrl(eventId: string): string {
  return `${PRISM_ORIGIN}/api/events/${eventId}/guest-list?ownerType=human&ownerId=${OWNER_HUMAN_ID}`;
}

async function readGuestList(eventId: string): Promise<PrismGuestList> {
  const res = await fetch(guestListUrl(eventId));
  if (!res.ok) throw new Error(`Guest list read failed: ${res.status}`);
  return (await res.json()) as PrismGuestList;
}

export function toGuestListEvent(event: UpcomingEvent, list: PrismGuestList): GuestListEvent {
  return {
    eventId: event.id,
    name: event.name,
    startDate: event.startDate,
    deadline: list.deadline,
    guestEmails: list.view.rows.map((r) => r.contact.email.toLowerCase()),
  };
}

/**
 * Raises Milad's own GA allocation on the event until it has a free spot, through AUF's Convex,
 * which creates the row when he has none. Answers a refusal reason, or null once a spot is free.
 */
async function ensureSpot(eventId: string): Promise<string | null> {
  const list = await readGuestList(eventId);
  const remaining = list.allocations.filter((a) => a.ticketTierId === GA_TIER_ID).reduce((sum, a) => sum + a.remaining, 0);
  const shortfall = 1 - remaining;
  if (shortfall <= 0) return null;
  if (!Number.isInteger(shortfall)) throw new Error("Guest list answered no usable remaining count");

  const url = process.env.AUF_CONVEX_URL;
  const pem = process.env.AUF_COMMA_JWT_PRIVATE_KEY;
  if (!url || !pem) return NO_SPOT;
  const res = await fetch(`${url}/api/action`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await aufToken(pem, "comma-guest-list")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path: "commaGuestList:ensureSpot", args: { eventId, shortfall }, format: "json" }),
  });
  const result = (await res.json().catch(() => ({}))) as { status?: string; value?: { ok: boolean; error?: string }; errorMessage?: string };
  if (result.status !== "success" || !result.value) throw new Error(`AUF allocation top-up failed: ${res.status} ${result.errorMessage ?? ""}`);
  return result.value.ok ? null : (result.value.error ?? NO_SPOT);
}

export const upcomingGuestLists = action({
  args: { key: v.optional(v.string()) },
  handler: async (ctx, { key }): Promise<GuestListEvent[]> => {
    await requireIdentityAccess(ctx, key);
    // Airtable's TODAY() is the UTC day.
    const today = new Date().toISOString().slice(0, 10);
    const events = await aufIdentityQuery<UpcomingEvent[]>("upcomingEvents", { today });

    const lists = await Promise.all(
      events.map(async (event) => {
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
    const refused = await ensureSpot(eventId);
    if (refused) return { outcome: "rejected", reason: refused };

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
