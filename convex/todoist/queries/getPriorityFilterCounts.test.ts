import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";

describe("getPriorityFilterCounts", () => {
  it("should return counts for all priority levels", async () => {
    const t = convexTest(schema);

    const result = await t.query(api.todoist.publicQueries.getPriorityFilterCounts);

    expect(result).toHaveProperty("totalRawTasks");
    expect(result).toHaveProperty("totalFilteredTasks");
    expect(result).toHaveProperty("totalTasksFilteredOut");
    expect(result).toHaveProperty("priorityCounts");
    expect(Array.isArray(result.priorityCounts)).toBe(true);
    expect(result.priorityCounts).toHaveLength(4);
  });

  it("should include all priority levels in correct order", async () => {
    const t = convexTest(schema);

    const result = await t.query(api.todoist.publicQueries.getPriorityFilterCounts);

    const priorities = result.priorityCounts.map((c) => c.priority);
    expect(priorities).toEqual([4, 3, 2, 1]); // P1 to P4
  });

  it("should calculate filtered vs raw counts correctly", async () => {
    const t = convexTest(schema);

    const result = await t.query(api.todoist.publicQueries.getPriorityFilterCounts);

    for (const count of result.priorityCounts) {
      expect(count.tasksFilteredOut).toBe(count.rawTaskCount - count.filteredTaskCount);
    }
  });
});
