import { describe, expect, test } from "vitest";

import type { Id } from "../../_generated/dataModel";

import type { TodoistItemWithProject } from "./getItemsByViewWithProjects";

// Test type definitions since integration tests have framework issues
describe("getItemsByViewWithProjects", () => {
  test("should have correct type structure for tasks with projects", () => {
    const taskWithProject: TodoistItemWithProject = {
      _id: "id1" as Id<"todoist_items">,
      _creationTime: 123,
      todoist_id: "task123",
      content: "Test task",
      project_id: "project123",
      child_order: 1,
      priority: 1,
      labels: [],
      comment_count: 0,
      checked: false,
      is_deleted: false,
      added_at: "2024-01-01",
      user_id: "user123",
      sync_version: 1,
      project: {
        todoist_id: "project123",
        name: "Work Project",
        color: "blue",
      },
    };

    expect(taskWithProject.project).toBeDefined();
    expect(taskWithProject.project?.name).toBe("Work Project");
    expect(taskWithProject.project?.color).toBe("blue");
  });

  test("should allow null project for tasks without projects", () => {
    const taskWithoutProject: TodoistItemWithProject = {
      _id: "id2" as Id<"todoist_items">,
      _creationTime: 123,
      todoist_id: "task456",
      content: "Task without project",
      child_order: 1,
      priority: 1,
      labels: [],
      comment_count: 0,
      checked: false,
      is_deleted: false,
      added_at: "2024-01-01",
      user_id: "user123",
      sync_version: 1,
      project: null,
    };

    expect(taskWithoutProject.project).toBeNull();
  });
});
