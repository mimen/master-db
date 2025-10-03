import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "../../_generated/api";
import schema from "../../schema";

describe("getLabelFilterCounts", () => {
  it("should return counts for all labels", async () => {
    const t = convexTest(schema);

    const result = await t.query(api.todoist.publicQueries.getLabelFilterCounts);

    expect(result).toHaveProperty("totalRawTasks");
    expect(result).toHaveProperty("totalFilteredTasks");
    expect(result).toHaveProperty("totalTasksFilteredOut");
    expect(result).toHaveProperty("labelCounts");
    expect(Array.isArray(result.labelCounts)).toBe(true);
  });

  it("should limit to top 50 labels", async () => {
    const t = convexTest(schema);

    const result = await t.query(api.todoist.publicQueries.getLabelFilterCounts);

    expect(result.labelCounts.length).toBeLessThanOrEqual(50);
  });

  it("should sort by highest raw task count", async () => {
    const t = convexTest(schema);

    const result = await t.query(api.todoist.publicQueries.getLabelFilterCounts);

    if (result.labelCounts.length > 1) {
      for (let i = 0; i < result.labelCounts.length - 1; i++) {
        expect(result.labelCounts[i].rawTaskCount).toBeGreaterThanOrEqual(
          result.labelCounts[i + 1].rawTaskCount
        );
      }
    }
  });

  it("should calculate filtered vs raw counts correctly", async () => {
    const t = convexTest(schema);

    const result = await t.query(api.todoist.publicQueries.getLabelFilterCounts);

    for (const count of result.labelCounts) {
      expect(count.tasksFilteredOut).toBe(count.rawTaskCount - count.filteredTaskCount);
    }
  });
});
