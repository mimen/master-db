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

type Call = { url: URL; method: string; body: unknown; auth: string | null };
const AUF = "https://fixture-auf.convex.cloud";

async function fixtureKey(): Promise<{ pem: string; publicKey: CryptoKey; kid: string }> {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const { n, e } = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ e, kty: "RSA", n }))));
  const kid = btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { pem: `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`, publicKey: pair.publicKey, kid };
}

/** Routes the add flow's endpoints and records every call, so a test can assert exactly what was written. */
function stubAddFlow({ remaining, topUp = { ok: true } }: { remaining: number | null; topUp?: { ok: boolean; error?: string } }) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const auth = new Headers(init?.headers).get("Authorization");
    calls.push({ url, method, auth, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.origin === AUF) return Response.json({ status: "success", value: topUp });
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
  test("with a spot free, posts one trimmed GA add and tops up nothing", async () => {
    const calls = stubAddFlow({ remaining: 2 });
    const t = convexTest(schema, modules);
    expect(await t.action(addToGuestListRef, guest)).toEqual({ outcome: "confirmed" });
    expect(calls.filter((c) => c.url.origin === AUF || c.url.hostname === "api.airtable.com")).toEqual([]);
    const post = calls.find((c) => c.method === "POST");
    expect(post?.url.toString()).toBe(`https://afternoonumbrellafriends.com/api/events/${FREAK}/guest-list?ownerType=human&ownerId=${MILAD}`);
    expect(post?.body).toMatchObject({ kind: "add", tierId: GA, contact: { firstName: "Chase", lastName: "Petersen", email: "chase@example.test" } });
  });

  test("with no spot free, tops up through AUF's Convex on its own signed token, then adds", async () => {
    const { pem, publicKey, kid } = await fixtureKey();
    vi.stubEnv("AUF_CONVEX_URL", AUF);
    vi.stubEnv("AUF_COMMA_JWT_PRIVATE_KEY", pem);
    const calls = stubAddFlow({ remaining: null });
    const t = convexTest(schema, modules);
    expect(await t.action(addToGuestListRef, { ...guest, eventId: ECHOES })).toEqual({ outcome: "confirmed" });

    expect(calls.filter((c) => c.url.hostname === "api.airtable.com")).toEqual([]);
    const topUp = calls.findIndex((c) => c.url.origin === AUF);
    expect(calls[topUp].url.pathname).toBe("/api/action");
    expect(calls[topUp].body).toEqual({ path: "commaGuestList:ensureSpot", args: { eventId: ECHOES, shortfall: 1 }, format: "json" });
    const [header, payload, signature] = (calls[topUp].auth ?? "").replace("Bearer ", "").split(".");
    const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    expect(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, fromB64url(signature), new TextEncoder().encode(`${header}.${payload}`))).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(fromB64url(header)))).toEqual({ alg: "RS256", typ: "JWT", kid });
    expect(JSON.parse(new TextDecoder().decode(fromB64url(payload)))).toMatchObject({ iss: "https://auf.network/comma", aud: "auf-comma", sub: "comma-guest-list" });
    expect(calls.findIndex((c) => c.method === "POST" && c.url.origin !== AUF)).toBeGreaterThan(topUp);
  });

  test("with no spot free and no AUF credential, refuses and writes nothing", async () => {
    const calls = stubAddFlow({ remaining: 0 });
    const t = convexTest(schema, modules);
    expect(await t.action(addToGuestListRef, guest)).toEqual({
      outcome: "rejected",
      reason: "No General Admission spot left on your list. Grant one in Backstage.",
    });
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  test("surfaces AUF's refusal of the top-up without adding", async () => {
    vi.stubEnv("AUF_CONVEX_URL", AUF);
    vi.stubEnv("AUF_COMMA_JWT_PRIVATE_KEY", (await fixtureKey()).pem);
    const calls = stubAddFlow({ remaining: 0, topUp: { ok: false, error: "Event is not upcoming." } });
    const t = convexTest(schema, modules);
    expect(await t.action(addToGuestListRef, guest)).toEqual({ outcome: "rejected", reason: "Event is not upcoming." });
    expect(calls.filter((c) => c.method === "POST" && c.url.origin !== AUF)).toEqual([]);
  });

  test("retries an unconfirmed add with the same commandId", async () => {
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
