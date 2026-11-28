import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { aufPath, aufReply, stubAuf } from "./aufFixture.vitest";
import { addToGuestListRef, TEST_KEY, upcomingGuestListsRef } from "./testRefs.vitest";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);

const FREAK = "reczGNezBIJaL27Z5";
const ECHOES = "recR0OxxHJlVBZbwW";
const GA = "recJzhaWLggd36A9Z";
const guest = { key: TEST_KEY, eventId: FREAK, firstName: " Chase ", lastName: "Petersen", email: "chase@example.test" };
const DEADLINE = "2026-11-01T00:00:00.000Z";

const list = (remaining: number | null, guestEmails: string[] = []) => ({
  ok: true,
  deadline: DEADLINE,
  allocations: remaining === null ? [] : [{ ticketTierId: GA, remaining }],
  guestEmails,
});

type Call = { path: string; args: Record<string, unknown>; sub: string };
type Replies = { list?: unknown; topUp?: unknown; add?: () => Response };
const payloadOf = (auth: string | null): { sub: string } =>
  JSON.parse(atob((auth ?? "").split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { sub: string };

/** Answers each AUF function and records every call with the lane its token named. */
function stubAufCalls({ list: read = list(2), topUp = { ok: true }, add }: Replies): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const auf = aufPath(input, init);
    if (!auf) throw new Error(`unexpected fetch ${String(input)}`);
    calls.push({ ...auf, sub: payloadOf(new Headers(init?.headers).get("Authorization")).sub });
    if (auf.path === "commaGuestList:guestList") return aufReply(read);
    if (auf.path === "commaGuestList:ensureSpot") return aufReply(topUp);
    return add ? add() : aufReply({ outcome: "confirmed" });
  }));
  return calls;
}

beforeEach(async () => {
  process.env.IMSG_IDENTITY_KEY = TEST_KEY;
  await stubAuf();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("upcomingGuestLists", () => {
  test("lists every upcoming event AUF opens, with Milad's guests' emails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const auf = aufPath(input, init);
      if (auf?.path === "commaIdentity:upcomingEvents") {
        expect(auf.args).toEqual({ today: new Date().toISOString().slice(0, 10) });
        return aufReply([
          { id: ECHOES, name: "ECHOES", startDate: "2026-10-25T05:00:00.000Z" },
          { id: FREAK, name: "Freakuency 2026", startDate: "2026-11-01T03:00:00.000Z" },
          { id: "recGoneSince00000", name: "Gone", startDate: "2026-11-02T03:00:00.000Z" },
        ]);
      }
      expect(auf?.path).toBe("commaGuestList:guestList");
      expect(payloadOf(new Headers(init?.headers).get("Authorization")).sub).toBe("comma-guest-list");
      const eventId = auf?.args.eventId;
      return aufReply(eventId === FREAK ? list(4, ["chase@example.test"])
        : eventId === ECHOES ? list(null) : { ok: false, error: "Quick add does not offer that event." });
    }));

    const t = convexTest(schema, modules);
    expect(await t.action(upcomingGuestListsRef, { key: TEST_KEY })).toEqual([
      { eventId: ECHOES, name: "ECHOES", startDate: "2026-10-25T05:00:00.000Z", deadline: DEADLINE, guestEmails: [] },
      { eventId: FREAK, name: "Freakuency 2026", startDate: "2026-11-01T03:00:00.000Z", deadline: DEADLINE, guestEmails: ["chase@example.test"] },
    ]);
  });

  test("rejects a caller without identity access before touching AUF", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const t = convexTest(schema, modules);
    await expect(t.action(upcomingGuestListsRef, { key: "wrong" })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("addToGuestList", () => {
  test("with a spot free, adds one trimmed guest on the guest-list lane and tops up nothing", async () => {
    const calls = stubAufCalls({});
    const t = convexTest(schema, modules);
    expect(await t.action(addToGuestListRef, guest)).toEqual({ outcome: "confirmed" });
    expect(calls.map((c) => [c.path, c.sub])).toEqual([
      ["commaGuestList:guestList", "comma-guest-list"],
      ["commaGuestList:addGuest", "comma-guest-list"],
    ]);
    expect(calls[1].args).toMatchObject({ eventId: FREAK, firstName: "Chase", lastName: "Petersen", email: "chase@example.test" });
    expect(Object.keys(calls[1].args).sort()).toEqual(["commandId", "email", "eventId", "firstName", "lastName"]);
  });

  test("with no spot free, tops up first, then adds", async () => {
    const calls = stubAufCalls({ list: list(null) });
    const t = convexTest(schema, modules);
    expect(await t.action(addToGuestListRef, { ...guest, eventId: ECHOES })).toEqual({ outcome: "confirmed" });
    expect(calls.map((c) => c.path)).toEqual(["commaGuestList:guestList", "commaGuestList:ensureSpot", "commaGuestList:addGuest"]);
    expect(calls[1].args).toEqual({ eventId: ECHOES, shortfall: 1 });
  });

  test("surfaces AUF's refusal of the list or the top-up without adding", async () => {
    let calls = stubAufCalls({ list: { ok: false, error: "Quick add does not offer that event." } });
    let t = convexTest(schema, modules);
    expect(await t.action(addToGuestListRef, guest)).toEqual({ outcome: "rejected", reason: "Quick add does not offer that event." });
    expect(calls.map((c) => c.path)).toEqual(["commaGuestList:guestList"]);

    calls = stubAufCalls({ list: list(0), topUp: { ok: false, error: "Guest allocation not found." } });
    t = convexTest(schema, modules);
    expect(await t.action(addToGuestListRef, guest)).toEqual({ outcome: "rejected", reason: "Guest allocation not found." });
    expect(calls.map((c) => c.path)).not.toContain("commaGuestList:addGuest");
  });

  test("fails loudly with no AUF credential, writing nothing", async () => {
    vi.stubEnv("AUF_COMMA_JWT_PRIVATE_KEY", "");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const t = convexTest(schema, modules);
    await expect(t.action(addToGuestListRef, guest)).rejects.toThrow("AUF_CONVEX_URL and AUF_COMMA_JWT_PRIVATE_KEY are not configured");
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("retries an add that failed in transit with the same commandId", async () => {
    const replies = [() => new Response("bad gateway", { status: 502 }), () => aufReply({ outcome: "confirmed" })];
    const calls = stubAufCalls({ add: () => (replies.shift() ?? (() => aufReply({})))() });
    const t = convexTest(schema, modules);
    expect(await t.action(addToGuestListRef, guest)).toEqual({ outcome: "confirmed" });
    const ids = calls.filter((c) => c.path === "commaGuestList:addGuest").map((c) => c.args.commandId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  test("answers unconfirmed after three failed attempts", async () => {
    stubAufCalls({ add: () => new Response("bad gateway", { status: 502 }) });
    const t = convexTest(schema, modules);
    expect(await t.action(addToGuestListRef, guest)).toEqual({ outcome: "unconfirmed" });
  });

  test("surfaces AUF's rejection reason", async () => {
    stubAufCalls({ add: () => aufReply({ outcome: "rejected", reason: "The guest list deadline has passed." }) });
    const t = convexTest(schema, modules);
    expect(await t.action(addToGuestListRef, guest)).toEqual({ outcome: "rejected", reason: "The guest list deadline has passed." });
  });

  test("refuses an event id that is not a record id before calling AUF", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const t = convexTest(schema, modules);
    expect(await t.action(addToGuestListRef, { ...guest, eventId: "../../admin" })).toEqual({ outcome: "rejected", reason: "Unknown event" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
