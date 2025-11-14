import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "../../_generated/api";
import schema from "../../schema";

describe("getTimeFilterCounts", () => {
  it("should return counts for all time filters", async () => {
    const t = convexTest(schema);

    const result = await t.query(api.todoist.publicQueries.getTimeFilterCounts, {});

    expect(result).toHaveProperty("totalRawTasks");
    expect(result).toHaveProperty("totalFilteredTasks");
    expect(result).toHaveProperty("totalTasksFilteredOut");
    expect(result).toHaveProperty("timeCounts");
    expect(Array.isArray(result.timeCounts)).toBe(true);
  });

  it("should include all time filter categories", async () => {
    const t = convexTest(schema);

    const result = await t.query(api.todoist.publicQueries.getTimeFilterCounts, {});

    const filters = result.timeCounts.map((c) => c.filter);
    expect(filters).toContain("overdue");
    expect(filters).toContain("today");
    expect(filters).toContain("tomorrow");
    expect(filters).toContain("next7days");
    expect(filters).toContain("future");
    expect(filters).toContain("nodate");
  });

  it("should calculate filtered vs raw counts correctly", async () => {
    const t = convexTest(schema);

    const result = await t.query(api.todoist.publicQueries.getTimeFilterCounts, {});

    for (const count of result.timeCounts) {
      expect(count.tasksFilteredOut).toBe(count.rawTaskCount - count.filteredTaskCount);
    }
  });
});
