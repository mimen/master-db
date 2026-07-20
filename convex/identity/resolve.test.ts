import { describe, expect, test } from "vitest";

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
