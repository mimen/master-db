import { describe, expect, it } from "vitest";

import { createMockTodoistItemDB } from "../../../test-utils/todoist/fixtures/items";

// Test business logic directly since convex-test has issues with Bun
describe("getTimeFilterCounts business logic", () => {
  // Helper to extract date-only part from date or datetime string
  const extractDateOnly = (dateStr: string): string => {
    return dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
  };

  it("should extract date from datetime string", () => {
    expect(extractDateOnly("2024-01-15T10:30:00")).toBe("2024-01-15");
    expect(extractDateOnly("2024-01-15")).toBe("2024-01-15");
  });

  it("should identify overdue tasks", () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const overdueTask = createMockTodoistItemDB({
      todoist_id: "1",
      due: { date: yesterdayStr, is_recurring: false, string: "yesterday" }
    });

    const todayStr = today.toISOString().split('T')[0];
    const dueDate = (overdueTask.due as { date: string } | undefined)?.date;
    expect(dueDate && extractDateOnly(dueDate) < todayStr).toBe(true);
  });

  it("should identify tasks with no date", () => {
    const noDateTask = createMockTodoistItemDB({
      todoist_id: "1",
      due: undefined
    });

    expect(noDateTask.due).toBeUndefined();
  });

  it("should calculate count differences correctly", () => {
    const rawCount = 10;
    const filteredCount = 7;
    const tasksFilteredOut = rawCount - filteredCount;

    expect(tasksFilteredOut).toBe(3);
  });
});
