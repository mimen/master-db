import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { addToGuestListRef, TEST_KEY, upcomingGuestListsRef } from "./testRefs.vitest";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);

const FREAK = "reczGNezBIJaL27Z5";
const ECHOES = "recR0OxxHJlVBZbwW";
const GA = "recJzhaWLggd36A9Z";
const MILAD = "rec6tdemsHYMY3X80";
const guest = { key: TEST_KEY, eventId: FREAK, firstName: " Chase ", lastName: "Petersen", email: "chase@example.test" };

function prismList(remaining: number | null, emails: string[] = []) {
  return {
    view: { rows: emails.map((email) => ({ contact: { firstName: "A", lastName: "B", email } })) },
    deadline: "2026-11-01T00:00:00.000Z",
    allocations: remaining === null ? [] : [{ id: GA, ticketTierId: GA, ticketTierName: "General Admission", count: 5, used: 5 - remaining, remaining }],
  };
}

type Call = { url: URL; method: string; body: unknown };

/** Routes the add flow's four endpoints and records every call, so a test can assert exactly what was written. */
function stubAddFlow({ remaining, allocationRow }: { remaining: number | null; allocationRow?: { id: string; count: number } }) {
  const calls: Call[] = [];
  vi.stubEnv("AIRTABLE_API_KEY", "fixture-airtable-key");
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.hostname === "api.airtable.com") {
      if (method === "GET") return Response.json({ records: allocationRow ? [{ id: allocationRow.id, fields: { Count: allocationRow.count } }] : [] });
      return Response.json({ records: [{ id: allocationRow?.id ?? "recNewAllocation", fields: {} }] });
    }
    return method === "GET" ? Response.json(prismList(remaining)) : Response.json({ outcome: "confirmed", list: {} });
  }));
  return calls;
}

beforeEach(() => {
  process.env.IMSG_IDENTITY_KEY = TEST_KEY;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("upcomingGuestLists", () => {
  test("lists every upcoming event, whether or not Milad holds spots, with his guests' emails", async () => {
    vi.stubEnv("AIRTABLE_API_KEY", "fixture-airtable-key");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "api.airtable.com") {
        expect(url.searchParams.get("filterByFormula")).toContain("{Event Status}!='Cancelled'");
        return Response.json({ records: [
          { id: ECHOES, fields: { Name: "ECHOES", "Start Date": "2026-10-25T05:00:00.000Z" } },
          { id: FREAK, fields: { Name: "Freakuency 2026", "Start Date": "2026-11-01T03:00:00.000Z" } },
        ] });
      }
      expect(url.searchParams.get("ownerId")).toBe(MILAD);
      return Response.json(url.pathname.includes(FREAK) ? prismList(4, ["Chase@Example.test"]) : prismList(null));
    }));

    const t = convexTest(schema, modules);
    expect(await t.action(upcomingGuestListsRef, { key: TEST_KEY })).toEqual([
      { eventId: ECHOES, name: "ECHOES", startDate: "2026-10-25T05:00:00.000Z", deadline: "2026-11-01T00:00:00.000Z", guestEmails: [] },
      { eventId: FREAK, name: "Freakuency 2026", startDate: "2026-11-01T03:00:00.000Z", deadline: "2026-11-01T00:00:00.000Z", guestEmails: ["chase@example.test"] },
    ]);
  });

  test("rejects a caller without identity access before touching Airtable", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const t = convexTest(schema, modules);
    await expect(t.action(upcomingGuestListsRef, { key: "wrong" })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("addToGuestList", () => {
  test("with a spot free, posts one trimmed GA add and writes nothing to Airtable", async () => {
    const calls = stubAddFlow({ remaining: 2 });
    const t = convexTest(schema, modules);
    expect(await t.action(addToGuestListRef, guest)).toEqual({ outcome: "confirmed" });
    expect(calls.filter((c) => c.url.hostname === "api.airtable.com")).toEqual([]);
    const post = calls.find((c) => c.method === "POST");
    expect(post?.url.toString()).toBe(`https://afternoonumbrellafriends.com/api/events/${FREAK}/guest-list?ownerType=human&ownerId=${MILAD}`);
    expect(post?.body).toMatchObject({ kind: "add", tierId: GA, contact: { firstName: "Chase", lastName: "Petersen", email: "chase@example.test" } });
  });

  test("with his allocation used up, raises his own GA row by one before adding", async () => {
    const calls = stubAddFlow({ remaining: 0, allocationRow: { id: "recMiladGA", count: 5 } });
    const t = convexTest(schema, modules);
    expect(await t.action(addToGuestListRef, guest)).toEqual({ outcome: "confirmed" });
    const patch = calls.findIndex((c) => c.method === "PATCH");
    expect(calls[patch].body).toEqual({ records: [{ id: "recMiladGA", fields: { Count: 6 } }] });
    expect(calls.findIndex((c) => c.method === "POST" && c.url.hostname !== "api.airtable.com")).toBeGreaterThan(patch);
  });

  test("with no allocation on the event, creates his GA row for one spot", async () => {
    const calls = stubAddFlow({ remaining: null });
    const t = convexTest(schema, modules);
    expect(await t.action(addToGuestListRef, { ...guest, eventId: ECHOES })).toEqual({ outcome: "confirmed" });
    const lookup = calls.find((c) => c.url.hostname === "api.airtable.com" && c.method === "GET");
    expect(lookup?.url.searchParams.get("filterByFormula")).toContain(`FIND('${MILAD}', ARRAYJOIN({Human ID}))`);
    expect(calls.find((c) => c.url.hostname === "api.airtable.com" && c.method === "POST")?.body).toEqual({
      records: [{ fields: { Event: [ECHOES], Human: [MILAD], "Ticket Tier": [GA], Count: 1, Reason: "Comma quick add" } }],
    });
  });

  test("retries an unconfirmed add with the same commandId", async () => {
    vi.stubEnv("AIRTABLE_API_KEY", "fixture-airtable-key");
    const replies = [Response.json({ outcome: "unconfirmed" }, { status: 202 }), Response.json({ outcome: "confirmed" })];
    const fetcher = vi.fn(async (_input: string | URL, init?: RequestInit) =>
      init?.method === "POST" ? (replies.shift() ?? Response.json({}, { status: 500 })) : Response.json(prismList(3)));
    vi.stubGlobal("fetch", fetcher);
    const t = convexTest(schema, modules);
    expect(await t.action(addToGuestListRef, guest)).toEqual({ outcome: "confirmed" });
    const ids = fetcher.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(String(init?.body)).commandId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  test("surfaces Prism's rejection reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL, init?: RequestInit) =>
      init?.method === "POST" ? Response.json({ outcome: "rejected", reason: "Deadline passed" }, { status: 409 }) : Response.json(prismList(3))));
    const t = convexTest(schema, modules);
    expect(await t.action(addToGuestListRef, guest)).toEqual({ outcome: "rejected", reason: "Deadline passed" });
  });

  test("refuses an event id that is not a record id instead of building a URL from it", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const t = convexTest(schema, modules);
    expect(await t.action(addToGuestListRef, { ...guest, eventId: "../../admin" })).toEqual({ outcome: "rejected", reason: "Unknown event" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
