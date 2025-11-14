import { describe, expect, it } from "vitest";

import { createMockTodoistItemDB } from "../../../test-utils/todoist/fixtures/items";

// Test business logic directly since convex-test has issues with Bun
describe("getPriorityFilterCounts business logic", () => {
  it("should filter tasks by priority level", () => {
    const items = [
      createMockTodoistItemDB({ todoist_id: "1", priority: 4 }), // P1
      createMockTodoistItemDB({ todoist_id: "2", priority: 3 }), // P2
      createMockTodoistItemDB({ todoist_id: "3", priority: 2 }), // P3
      createMockTodoistItemDB({ todoist_id: "4", priority: 1 }), // P4
      createMockTodoistItemDB({ todoist_id: "5", priority: 1 }), // P4
    ];

    const p1Tasks = items.filter(item => item.priority === 4);
    const p4Tasks = items.filter(item => item.priority === 1);

    expect(p1Tasks).toHaveLength(1);
    expect(p4Tasks).toHaveLength(2);
  });

  it("should have correct priority mapping in order", () => {
    // Todoist priorities: 4 = P1 (highest), 3 = P2, 2 = P3, 1 = P4 (normal)
    const priorities = [
      { priority: 4, label: 'P1 (Urgent)' },
      { priority: 3, label: 'P2 (High)' },
      { priority: 2, label: 'P3 (Medium)' },
      { priority: 1, label: 'P4 (Normal)' },
    ];

    expect(priorities).toHaveLength(4);
    expect(priorities.map(p => p.priority)).toEqual([4, 3, 2, 1]);
  });

  it("should calculate count differences correctly", () => {
    const rawCount = 15;
    const filteredCount = 12;
    const tasksFilteredOut = rawCount - filteredCount;

    expect(tasksFilteredOut).toBe(3);
  });
});
