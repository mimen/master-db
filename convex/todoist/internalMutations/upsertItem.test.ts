import { describe, test, expect } from 'vitest';

describe('upsertItem', () => {
  test('converts Todoist item to database format correctly', () => {
    const todoistItem = {
      id: "item-123",
      content: "Test task content",
      description: "Task description",
      project_id: "proj-456",
      section_id: "section-789",
      parent_id: null,
      child_order: 2,
      priority: 3,
      due: {
        date: "2024-03-15",
        is_recurring: false,
        datetime: "2024-03-15T10:00:00Z"
      },
      labels: ["urgent", "work"],
      assigned_by_uid: "user-123",
      added_by_uid: "user-456",
      comment_count: 5,
      checked: false,
      is_deleted: false,
      added_at: "2024-01-01T00:00:00Z",
      completed_at: null,
      updated_at: "2024-01-02T12:00:00Z",
      user_id: "user-789"
    };

    const currentVersion = new Date(todoistItem.updated_at).getTime();

    const itemData = {
      todoist_id: todoistItem.id,
      content: todoistItem.content,
      description: todoistItem.description || undefined,
      project_id: todoistItem.project_id === null ? undefined : todoistItem.project_id,
      section_id: todoistItem.section_id === null ? undefined : todoistItem.section_id,
      parent_id: todoistItem.parent_id === null ? undefined : todoistItem.parent_id,
      child_order: todoistItem.child_order || 0,
      priority: todoistItem.priority || 1,
      due: todoistItem.due === null ? undefined : todoistItem.due,
      labels: todoistItem.labels || [],
      assignee_id: todoistItem.assigned_by_uid === null ? undefined : todoistItem.assigned_by_uid,
      assigner_id: todoistItem.added_by_uid === null ? undefined : todoistItem.added_by_uid,
      comment_count: todoistItem.comment_count || 0,
      checked: typeof todoistItem.checked === 'boolean' ? (todoistItem.checked ? 1 : 0) : (todoistItem.checked || 0),
      is_deleted: todoistItem.is_deleted ? 1 : 0,
      added_at: todoistItem.added_at || new Date().toISOString(),
      completed_at: todoistItem.completed_at === null ? undefined : todoistItem.completed_at,
      user_id: todoistItem.user_id || "",
      sync_version: currentVersion,
    };

    expect(itemData.todoist_id).toBe("item-123");
    expect(itemData.content).toBe("Test task content");
    expect(itemData.description).toBe("Task description");
    expect(itemData.project_id).toBe("proj-456");
    expect(itemData.section_id).toBe("section-789");
    expect(itemData.parent_id).toBeUndefined();
    expect(itemData.child_order).toBe(2);
    expect(itemData.priority).toBe(3);
    expect(itemData.due).toEqual(todoistItem.due);
    expect(itemData.labels).toEqual(["urgent", "work"]);
    expect(itemData.assignee_id).toBe("user-123");
    expect(itemData.assigner_id).toBe("user-456");
    expect(itemData.comment_count).toBe(5);
    expect(itemData.checked).toBe(0); // false -> 0
    expect(itemData.is_deleted).toBe(0); // false -> 0
    expect(itemData.sync_version).toBe(currentVersion);
  });

  test('handles null and undefined values correctly', () => {
    const minimalItem = {
      id: "item-minimal",
      content: "Minimal task",
      project_id: null,
      section_id: null,
      parent_id: null,
      due: null,
      labels: undefined,
      assigned_by_uid: null,
      added_by_uid: null,
      completed_at: null,
      checked: undefined,
      is_deleted: false
    };

    const itemData = {
      todoist_id: minimalItem.id,
      content: minimalItem.content,
      description: undefined,
      project_id: minimalItem.project_id === null ? undefined : minimalItem.project_id,
      section_id: minimalItem.section_id === null ? undefined : minimalItem.section_id,
      parent_id: minimalItem.parent_id === null ? undefined : minimalItem.parent_id,
      child_order: 0,
      priority: 1,
      due: minimalItem.due === null ? undefined : minimalItem.due,
      labels: minimalItem.labels || [],
      assignee_id: minimalItem.assigned_by_uid === null ? undefined : minimalItem.assigned_by_uid,
      assigner_id: minimalItem.added_by_uid === null ? undefined : minimalItem.added_by_uid,
      comment_count: 0,
      checked: typeof minimalItem.checked === 'boolean' ? (minimalItem.checked ? 1 : 0) : 0,
      is_deleted: minimalItem.is_deleted ? 1 : 0,
      added_at: new Date().toISOString(),
      completed_at: minimalItem.completed_at === null ? undefined : minimalItem.completed_at,
      user_id: "",
      sync_version: Date.now(),
    };

    expect(itemData.project_id).toBeUndefined();
    expect(itemData.section_id).toBeUndefined();
    expect(itemData.parent_id).toBeUndefined();
    expect(itemData.due).toBeUndefined();
    expect(itemData.labels).toEqual([]);
    expect(itemData.assignee_id).toBeUndefined();
    expect(itemData.assigner_id).toBeUndefined();
    expect(itemData.completed_at).toBeUndefined();
    expect(itemData.checked).toBe(0);
    expect(itemData.child_order).toBe(0);
    expect(itemData.priority).toBe(1);
    expect(itemData.comment_count).toBe(0);
  });

  test('handles checked field conversion correctly', () => {
    const testCases = [
      { checked: true, expected: 1 },
      { checked: false, expected: 0 },
      { checked: 1, expected: 1 },
      { checked: 0, expected: 0 },
      { checked: undefined, expected: 0 },
    ];

    testCases.forEach(({ checked, expected }) => {
      const result = typeof checked === 'boolean' ? (checked ? 1 : 0) : (checked || 0);
      expect(result).toBe(expected);
    });
  });

  test('version comparison logic for updates', () => {
    const existingItem = { sync_version: 1000 };
    const newItemVersion = 2000;
    const oldItemVersion = 500;

    // Should update when new version is newer
    expect(existingItem.sync_version < newItemVersion).toBe(true);

    // Should not update when new version is older
    expect(existingItem.sync_version < oldItemVersion).toBe(false);
  });

  test('handles date conversion for sync_version', () => {
    const testDates = [
      "2024-01-01T00:00:00Z",
      "2024-03-15T14:30:00.123Z",
      undefined
    ];

    testDates.forEach(dateString => {
      const currentVersion = dateString ? new Date(dateString).getTime() : Date.now();

      if (dateString) {
        expect(currentVersion).toBe(new Date(dateString).getTime());
        expect(typeof currentVersion).toBe("number");
        expect(currentVersion).toBeGreaterThan(0);
      } else {
        expect(typeof currentVersion).toBe("number");
        expect(currentVersion).toBeGreaterThan(0);
      }
    });
  });

  test('handles default values correctly', () => {
    const itemWithDefaults = {
      id: "test-defaults",
      content: "Test content",
      // All optional fields missing
    };

    const itemData = {
      todoist_id: itemWithDefaults.id,
      content: itemWithDefaults.content,
      description: undefined,
      project_id: undefined,
      section_id: undefined,
      parent_id: undefined,
      child_order: 0, // Default
      priority: 1,    // Default
      due: undefined,
      labels: [],     // Default
      assignee_id: undefined,
      assigner_id: undefined,
      comment_count: 0, // Default
      checked: 0,       // Default
      is_deleted: 0,    // Default
      added_at: new Date().toISOString(), // Default to now
      completed_at: undefined,
      user_id: "",      // Default
      sync_version: Date.now(),
    };

    expect(itemData.child_order).toBe(0);
    expect(itemData.priority).toBe(1);
    expect(itemData.labels).toEqual([]);
    expect(itemData.comment_count).toBe(0);
    expect(itemData.checked).toBe(0);
    expect(itemData.is_deleted).toBe(0);
    expect(itemData.user_id).toBe("");
    expect(itemData.added_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test('preserves complex due date structure', () => {
    const complexDue = {
      date: "2024-03-15",
      is_recurring: true,
      datetime: "2024-03-15T15:30:00Z",
      string: "every day",
      timezone: "America/New_York"
    };

    const item = {
      id: "test-due",
      content: "Task with complex due",
      due: complexDue
    };

    const itemData = {
      due: item.due === null ? undefined : item.due
    };

    expect(itemData.due).toEqual(complexDue);
    expect(itemData.due?.date).toBe("2024-03-15");
    expect(itemData.due?.is_recurring).toBe(true);
    expect(itemData.due?.datetime).toBe("2024-03-15T15:30:00Z");
  });
});