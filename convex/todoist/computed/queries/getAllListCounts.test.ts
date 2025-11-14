import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "../../../_generated/api";
import schema from "../../../schema";

describe("getAllListCounts", () => {
  it("should return a record of list counts", async () => {
    const t = convexTest(schema);

    const counts = await t.query(api.todoist.computed.index.getAllListCounts, {});

    expect(counts).toBeDefined();
    expect(typeof counts).toBe("object");
  });

  it("should include time filter keys", async () => {
    const t = convexTest(schema);

    const counts = await t.query(api.todoist.computed.index.getAllListCounts, {});

    // Check that time filter keys exist (even if counts are 0)
    expect(counts).toHaveProperty("list:time:overdue");
    expect(counts).toHaveProperty("list:time:today");
    expect(counts).toHaveProperty("list:time:tomorrow");
    expect(counts).toHaveProperty("list:time:next7days");
    expect(counts).toHaveProperty("list:time:future");
    expect(counts).toHaveProperty("list:time:nodate");
  });

  it("should include priority filter keys", async () => {
    const t = convexTest(schema);

    const counts = await t.query(api.todoist.computed.index.getAllListCounts, {});

    // Check that priority filter keys exist
    expect(counts).toHaveProperty("list:priority:p1");
    expect(counts).toHaveProperty("list:priority:p2");
    expect(counts).toHaveProperty("list:priority:p3");
    expect(counts).toHaveProperty("list:priority:p4");
  });

  it("should return valid count numbers", async () => {
    const t = convexTest(schema);

    const counts = await t.query(api.todoist.computed.index.getAllListCounts, {});

    // All counts should be non-negative numbers
    for (const [, count] of Object.entries(counts)) {
      expect(typeof count).toBe("number");
      expect(count).toBeGreaterThanOrEqual(0);
    }
  });
});
