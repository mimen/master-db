import { describe, expect, test } from "vitest";

import { aggregateIdentityCandidates, type RawIdentityCandidate } from "./resolve";

function raw(overrides: Partial<RawIdentityCandidate> = {}): RawIdentityCandidate {
  return {
    network: "whatsapp",
    value: "+16195551234@s.whatsapp.net",
    kind: "whatsapp",
    normalized: "+16195551234",
    is_self: false,
    source: "participant",
    ...overrides,
  };
}

describe("aggregateIdentityCandidates", () => {
  test("chat_count reflects the number of chats this run saw the handle in", () => {
    const raws = [raw(), raw(), raw()];
    const [agg] = aggregateIdentityCandidates(raws);
    expect(agg?.chat_count).toBe(3);
  });

  test("a later run with fewer appearances produces a lower chat_count (set, not increment)", () => {
    const firstRun = aggregateIdentityCandidates([raw(), raw(), raw()]);
    expect(firstRun[0]?.chat_count).toBe(3);

    const secondRun = aggregateIdentityCandidates([raw()]);
    expect(secondRun[0]?.chat_count).toBe(1);
  });

  test("re-running with identical input produces an identical aggregate (idempotency)", () => {
    const raws = [raw({ last_seen_at: "2026-01-01T00:00:00.000Z" }), raw({ last_seen_at: "2026-01-02T00:00:00.000Z" })];
    const first = aggregateIdentityCandidates(raws);
    const second = aggregateIdentityCandidates(raws);
    expect(second).toEqual(first);
  });

  test("longer display_name wins across sightings", () => {
    const raws = [raw({ display_name: "Chase" }), raw({ display_name: "Chase Petersen" }), raw({ display_name: "C" })];
    const [agg] = aggregateIdentityCandidates(raws);
    expect(agg?.display_name).toBe("Chase Petersen");
  });

  test("last_seen_at only advances to the max across sightings", () => {
    const raws = [
      raw({ last_seen_at: "2026-01-05T00:00:00.000Z" }),
      raw({ last_seen_at: "2026-01-01T00:00:00.000Z" }),
      raw({ last_seen_at: "2026-01-10T00:00:00.000Z" }),
    ];
    const [agg] = aggregateIdentityCandidates(raws);
    expect(agg?.last_seen_at).toBe("2026-01-10T00:00:00.000Z");
  });

  test("is_self is OR'd across sightings", () => {
    const raws = [raw({ is_self: false }), raw({ is_self: true }), raw({ is_self: false })];
    const [agg] = aggregateIdentityCandidates(raws);
    expect(agg?.is_self).toBe(true);
  });

  test("phone_number and img_url are first-wins", () => {
    const raws = [
      raw({ phone_number: undefined, img_url: undefined }),
      raw({ phone_number: "+16195551234", img_url: "https://example.com/a.png" }),
      raw({ phone_number: "+19995551234", img_url: "https://example.com/b.png" }),
    ];
    const [agg] = aggregateIdentityCandidates(raws);
    expect(agg?.phone_number).toBe("+16195551234");
    expect(agg?.img_url).toBe("https://example.com/a.png");
  });

  test("distinct (network, value) pairs stay separate candidates", () => {
    const raws = [
      raw({ network: "whatsapp", value: "a" }),
      raw({ network: "imessage", value: "a" }),
      raw({ network: "whatsapp", value: "b" }),
    ];
    const aggregated = aggregateIdentityCandidates(raws);
    expect(aggregated).toHaveLength(3);
  });
});

/**
 * Replicates the Phase 2 clustering logic in resolveIdentities (convex/identity/resolve.ts):
 * group identity ids by normalized key, skipping identities with no join key.
 */
describe("resolveIdentities clustering", () => {
  test("groups identity ids by shared normalized key", () => {
    const identities = [
      { _id: "id1", normalized: "+16195551234" },
      { _id: "id2", normalized: "+16195551234" },
      { _id: "id3", normalized: "milad@example.com" },
    ];
    const groups = new Map<string, string[]>();
    for (const i of identities) {
      if (!i.normalized) continue;
      const arr = groups.get(i.normalized) ?? [];
      arr.push(i._id);
      groups.set(i.normalized, arr);
    }
    expect(groups.get("+16195551234")).toEqual(["id1", "id2"]);
    expect(groups.get("milad@example.com")).toEqual(["id3"]);
    expect(groups.size).toBe(2);
  });

  test("identities with no normalized key are left unclustered", () => {
    const identities = [
      { _id: "id1", normalized: "" },
      { _id: "id2", normalized: "+16195551234" },
    ];
    const groups = new Map<string, string[]>();
    for (const i of identities) {
      if (!i.normalized) continue;
      const arr = groups.get(i.normalized) ?? [];
      arr.push(i._id);
      groups.set(i.normalized, arr);
    }
    expect(groups.has("")).toBe(false);
    expect(groups.size).toBe(1);
  });

  test("a single-identity group still produces a cluster of size one", () => {
    const identities = [{ _id: "id1", normalized: "+16195551234" }];
    const groups = new Map<string, string[]>();
    for (const i of identities) {
      if (!i.normalized) continue;
      const arr = groups.get(i.normalized) ?? [];
      arr.push(i._id);
      groups.set(i.normalized, arr);
    }
    expect(groups.get("+16195551234")).toEqual(["id1"]);
  });
});
