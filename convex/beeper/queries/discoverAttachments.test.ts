import { describe, expect, test } from "vitest";

describe("discoverAttachments partition", () => {
  test("splits input into uploaded vs missing based on existing rows", () => {
    const existing = new Map([
      ["mxc://a", "kg_a"],
      ["mxc://b", "kg_b"],
    ]);
    const input = ["mxc://a", "mxc://b", "mxc://c", "mxc://d"];

    const uploaded: { mxc_id: string; convex_storage_id: string }[] = [];
    const missing: string[] = [];
    for (const mxc_id of input) {
      const sid = existing.get(mxc_id);
      if (sid) uploaded.push({ mxc_id, convex_storage_id: sid });
      else missing.push(mxc_id);
    }

    expect(uploaded).toEqual([
      { mxc_id: "mxc://a", convex_storage_id: "kg_a" },
      { mxc_id: "mxc://b", convex_storage_id: "kg_b" },
    ]);
    expect(missing).toEqual(["mxc://c", "mxc://d"]);
  });

  test("empty input → empty output", () => {
    const uploaded: unknown[] = [];
    const missing: unknown[] = [];
    expect(uploaded.length).toBe(0);
    expect(missing.length).toBe(0);
  });
});
