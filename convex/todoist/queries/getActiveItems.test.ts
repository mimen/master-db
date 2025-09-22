import { describe, test, expect } from "vitest";

import { createMockTodoistItemDB } from "../../../test-utils/todoist/fixtures/items";
import { applyGlobalFilters } from "../helpers/globalFilters";

// Test business logic directly since convex-test has issues with Bun
describe('getActiveItems with global filters', () => {
  test('filters out star prefix tasks', () => {
    const items = [
      createMockTodoistItemDB({ content: "* Metadata task", todoist_id: "1" }),
      createMockTodoistItemDB({ content: "Regular task", todoist_id: "2" }),
    ];

    const filtered = applyGlobalFilters(items, {});

    expect(filtered).toHaveLength(1);
    expect(filtered[0].content).toBe("Regular task");
  });

  test('filters out system labels', () => {
    const items = [
      createMockTodoistItemDB({ labels: ["project-metadata", "custom"], todoist_id: "1" }),
      createMockTodoistItemDB({ labels: ["custom"], todoist_id: "2" }),
    ];

    const filtered = applyGlobalFilters(items, {});

    expect(filtered).toHaveLength(1);
    expect(filtered[0].todoist_id).toBe("2");
  });

  test('respects assignee filter', () => {
    const items = [
      createMockTodoistItemDB({
        todoist_id: "1",
        content: "Unassigned task",
        assignee_id: null,
        user_id: "test-user"
      }),
      createMockTodoistItemDB({
        todoist_id: "2",
        content: "Assigned to me",
        assignee_id: "test-user",
        user_id: "test-user"
      }),
      createMockTodoistItemDB({
        todoist_id: "3",
        content: "Assigned to other",
        assignee_id: "other-user",
        user_id: "other-user"
      }),
    ];

    // Test default filter (not assigned to others)
    let filtered = applyGlobalFilters(items, { currentUserId: "test-user" });
    expect(filtered).toHaveLength(2);
    expect(filtered.map(item => item.todoist_id)).toContain("1");
    expect(filtered.map(item => item.todoist_id)).toContain("2");

    // Test unassigned filter
    filtered = applyGlobalFilters(items, { assigneeFilter: "unassigned", currentUserId: "test-user" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].content).toBe("Unassigned task");
  });
});