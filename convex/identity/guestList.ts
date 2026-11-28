import { v } from "convex/values";

import { action } from "../_generated/server";

import { aufCall, aufIdentityQuery } from "./aufConvex";
import { requireIdentityAccess } from "./key";

/**
 * Milad's own AUF guest lists, for Comma's quick add, all through AUF's Convex on Comma's own
 * key: the upcoming events on the identity lane, and his list on the guest-list lane
 * (AUF `convex/commaGuestList.ts`), which fixes the owner to Milad and the tier to General
 * Admission and enforces his list's spots and deadline. His list is uncapped, so an add first
 * tops up his own General Admission allocation there; a direct Airtable write would be reverted
 * as drift.
 */

/** AUF's global General Admission tier, valid on every event. */
const GA_TIER_ID = "recJzhaWLggd36A9Z";
const RECORD_ID = /^rec[A-Za-z0-9]+$/;

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

/** AUF `commaGuestList:guestList`: Milad's own spots by tier, deadline and guests. */
type GuestList = {
  deadline: string | null;
  allocations: { ticketTierId: string; remaining: number }[];
  guestEmails: string[];
};
type Refused = { ok: false; error: string };

const readGuestList = (eventId: string): Promise<({ ok: true } & GuestList) | Refused> =>
  aufCall("query", "commaGuestList:guestList", { eventId }, "comma-guest-list");

export function toGuestListEvent(event: UpcomingEvent, list: GuestList): GuestListEvent {
  return { eventId: event.id, name: event.name, startDate: event.startDate, deadline: list.deadline, guestEmails: list.guestEmails };
}

/**
 * Raises Milad's own GA allocation on the event until it has a free spot, through AUF's Convex,
 * which creates the row when he has none. Answers a refusal reason, or null once a spot is free.
 */
async function ensureSpot(eventId: string): Promise<string | null> {
  const list = await readGuestList(eventId);
  if (!list.ok) return list.error;
  const remaining = list.allocations.filter((a) => a.ticketTierId === GA_TIER_ID).reduce((sum, a) => sum + a.remaining, 0);
  const shortfall = 1 - remaining;
  if (shortfall <= 0) return null;
  if (!Number.isInteger(shortfall)) throw new Error("Guest list answered no usable remaining count");
  const topUp = await aufCall<{ ok: true } | Refused>("action", "commaGuestList:ensureSpot", { eventId, shortfall }, "comma-guest-list");
  return topUp.ok ? null : topUp.error;
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
        const list = await readGuestList(event.id);
        return list.ok ? toGuestListEvent(event, list) : null;
      }),
    );
    return lists.filter((l): l is GuestListEvent => l !== null);
  },
});

/** Adds one General Admission guest to Milad's list. A call that fails in transit may have
 * committed, so it is retried with the same commandId, which AUF confirms once. */
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

    const args = { eventId, commandId: crypto.randomUUID(), firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim() };
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await aufCall<{ outcome: "confirmed" } | { outcome: "rejected"; reason: string }>(
        "mutation", "commaGuestList:addGuest", args, "comma-guest-list",
      ).catch(() => null);
      if (result) return result;
    }
    return { outcome: "unconfirmed" };
  },
});
