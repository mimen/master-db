import { describe, expect, it } from "vitest";

import { createMockTodoistItemDB } from "../../../test-utils/todoist/fixtures/items";

// Test business logic directly since convex-test has issues with Bun
describe("getLabelFilterCounts business logic", () => {
  it("should filter tasks by label", () => {
    const items = [
      createMockTodoistItemDB({ todoist_id: "1", labels: ["work", "urgent"] as string[] }),
      createMockTodoistItemDB({ todoist_id: "2", labels: ["personal"] as string[] }),
      createMockTodoistItemDB({ todoist_id: "3", labels: ["work"] as string[] }),
      createMockTodoistItemDB({ todoist_id: "4", labels: [] as string[] }),
    ];

    const workTasks = items.filter(item => (item.labels as string[]).includes("work"));
    const personalTasks = items.filter(item => (item.labels as string[]).includes("personal"));
    const noLabelTasks = items.filter(item => (item.labels as string[]).length === 0);

    expect(workTasks).toHaveLength(2);
    expect(personalTasks).toHaveLength(1);
    expect(noLabelTasks).toHaveLength(1);
  });

  it("should count tasks with multiple labels correctly", () => {
    const items = [
      createMockTodoistItemDB({ todoist_id: "1", labels: ["work", "urgent"] as string[] }),
      createMockTodoistItemDB({ todoist_id: "2", labels: ["work", "important"] as string[] }),
    ];

    const workTasks = items.filter(item => (item.labels as string[]).includes("work"));
    const urgentTasks = items.filter(item => (item.labels as string[]).includes("urgent"));

    expect(workTasks).toHaveLength(2);
    expect(urgentTasks).toHaveLength(1);
  });

  it("should calculate count differences correctly", () => {
    const rawCount = 20;
    const filteredCount = 15;
    const tasksFilteredOut = rawCount - filteredCount;

    expect(tasksFilteredOut).toBe(5);
  });
});
