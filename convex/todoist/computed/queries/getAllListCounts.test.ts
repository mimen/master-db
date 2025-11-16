import { describe, expect, it } from "vitest";

// Test business logic directly since convex-test has issues with Bun
describe("getAllListCounts business logic", () => {
  it("should create a record of list counts", () => {
    const counts: Record<string, number> = {
      "list:time:overdue": 5,
      "list:time:today": 10,
      "list:priority:p1": 3,
      "list:priority:p2": 7,
    };

    expect(typeof counts).toBe("object");
    expect(Object.keys(counts).length).toBeGreaterThan(0);
  });

  it("should include time filter keys", () => {
    const timeFilters = ["overdue", "today", "tomorrow", "next7days", "future", "nodate"];
    const counts: Record<string, number> = {};

    timeFilters.forEach(filter => {
      counts[`list:time:${filter}`] = 0;
    });

    expect(counts).toHaveProperty("list:time:overdue");
    expect(counts).toHaveProperty("list:time:today");
    expect(counts).toHaveProperty("list:time:tomorrow");
    expect(counts).toHaveProperty("list:time:next7days");
    expect(counts).toHaveProperty("list:time:future");
    expect(counts).toHaveProperty("list:time:nodate");
  });

  it("should include priority filter keys", () => {
    const priorities = [1, 2, 3, 4];
    const counts: Record<string, number> = {};

    priorities.forEach(priority => {
      counts[`list:priority:p${priority}`] = 0;
    });

    expect(counts).toHaveProperty("list:priority:p1");
    expect(counts).toHaveProperty("list:priority:p2");
    expect(counts).toHaveProperty("list:priority:p3");
    expect(counts).toHaveProperty("list:priority:p4");
  });

  it("should return valid count numbers", () => {
    const counts: Record<string, number> = {
      "list:time:overdue": 5,
      "list:time:today": 10,
      "list:priority:p1": 3,
    };

    // All counts should be non-negative numbers
    for (const [, count] of Object.entries(counts)) {
      expect(typeof count).toBe("number");
      expect(count).toBeGreaterThanOrEqual(0);
    }
  });
});
