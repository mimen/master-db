import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { addToGuestListRef, TEST_KEY, upcomingGuestListsRef } from "./testRefs.vitest";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);

const FREAK = "reczGNezBIJaL27Z5";
const ECHOES = "recR0OxxHJlVBZbwW";
const GA = "recJzhaWLggd36A9Z";
const guest = { key: TEST_KEY, eventId: FREAK, tierId: GA, firstName: " Chase ", lastName: "Petersen", email: "chase@example.test" };

function prismList(allocations: { count: number; remaining: number }[], emails: string[] = []) {
  return {
    view: { rows: emails.map((email) => ({ contact: { firstName: "A", lastName: "B", email } })) },
    deadline: "2026-11-01T00:00:00.000Z",
    allocations: allocations.map((a) => ({ id: GA, ticketTierId: GA, ticketTierName: "General Admission", used: a.count - a.remaining, ...a })),
  };
}

beforeEach(() => {
  process.env.IMSG_IDENTITY_KEY = TEST_KEY;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("upcomingGuestLists", () => {
  test("lists only upcoming events Milad holds spots for, with his guests' emails", async () => {
    vi.stubEnv("AIRTABLE_API_KEY", "fixture-airtable-key");
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "api.airtable.com") {
        expect(url.searchParams.get("filterByFormula")).toContain("{Event Status}!='Cancelled'");
        return Response.json({ records: [
          { id: ECHOES, fields: { Name: "ECHOES", "Start Date": "2026-10-25T05:00:00.000Z" } },
          { id: FREAK, fields: { Name: "Freakuency 2026", "Start Date": "2026-11-01T03:00:00.000Z" } },
        ] });
      }
      expect(url.searchParams.get("ownerId")).toBe("rec6tdemsHYMY3X80");
      return Response.json(url.pathname.includes(FREAK) ? prismList([{ count: 5, remaining: 4 }], ["Chase@Example.test"]) : prismList([]));
    });
    vi.stubGlobal("fetch", fetcher);

    const t = convexTest(schema, modules);
    expect(await t.action(upcomingGuestListsRef, { key: TEST_KEY })).toEqual([
      {
        eventId: FREAK,
        name: "Freakuency 2026",
        startDate: "2026-11-01T03:00:00.000Z",
        deadline: "2026-11-01T00:00:00.000Z",
        tiers: [{ tierId: GA, tierName: "General Admission", remaining: 4 }],
        guestEmails: ["chase@example.test"],
      },
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
  test("posts one trimmed add command to Milad's list", async () => {
    const fetcher = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        kind: "add",
        tierId: GA,
        contact: { firstName: "Chase", lastName: "Petersen", email: "chase@example.test" },
      });
      return Response.json({ outcome: "confirmed", list: {} });
    });
    vi.stubGlobal("fetch", fetcher);
    const t = convexTest(schema, modules);
    expect(await t.action(addToGuestListRef, guest)).toEqual({ outcome: "confirmed" });
    expect(String(fetcher.mock.calls[0][0])).toBe(
      `https://afternoonumbrellafriends.com/api/events/${FREAK}/guest-list?ownerType=human&ownerId=rec6tdemsHYMY3X80`,
    );
  });

  test("retries an unconfirmed add with the same commandId", async () => {
    const replies = [Response.json({ outcome: "unconfirmed" }, { status: 202 }), Response.json({ outcome: "confirmed" })];
    const fetcher = vi.fn(async () => replies.shift() ?? Response.json({}, { status: 500 }));
    vi.stubGlobal("fetch", fetcher);
    const t = convexTest(schema, modules);
    expect(await t.action(addToGuestListRef, guest)).toEqual({ outcome: "confirmed" });
    const ids = fetcher.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)).commandId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  test("surfaces Prism's rejection reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ outcome: "rejected", reason: "No spots left" }, { status: 409 })));
    const t = convexTest(schema, modules);
    expect(await t.action(addToGuestListRef, guest)).toEqual({ outcome: "rejected", reason: "No spots left" });
  });

  test("refuses an event id that is not a record id instead of building a URL from it", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const t = convexTest(schema, modules);
    expect(await t.action(addToGuestListRef, { ...guest, eventId: "../../admin" })).toEqual({ outcome: "rejected", reason: "Unknown event or tier" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
