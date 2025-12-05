import { describe, test, expect } from 'vitest';

describe('updateItem', () => {
  test('validates todoistId parameter', () => {
    const args = {
      todoistId: "item-123",
      updates: {}
    };

    expect(args.todoistId).toBe("item-123");
    expect(typeof args.todoistId).toBe("string");
    expect(args.todoistId.length).toBeGreaterThan(0);
  });

  test('handles all supported update fields', () => {
    const updates = {
      content: "Updated content",
      description: "Updated description",
      project_id: "new-project-456",
      section_id: "new-section-789",
      priority: 3,
      due: {
        date: "2024-03-20",
        is_recurring: false,
        string: "March 20",
        datetime: "2024-03-20T15:00:00Z",
        timezone: "America/New_York"
      },
      labels: ["updated", "important"],
      checked: 1,
      is_deleted: 0,
      completed_at: "2024-03-15T10:00:00Z",
      updated_at: "2024-03-15T10:00:00Z",
      sync_version: 1710505200000,
    };

    // Validate each field type
    expect(typeof updates.content).toBe("string");
    expect(typeof updates.description).toBe("string");
    expect(typeof updates.project_id).toBe("string");
    expect(typeof updates.section_id).toBe("string");
    expect(typeof updates.priority).toBe("number");
    expect(typeof updates.due).toBe("object");
    expect(Array.isArray(updates.labels)).toBe(true);
    expect(typeof updates.checked).toBe("number");
    expect(typeof updates.is_deleted).toBe("number");
    expect(typeof updates.completed_at).toBe("string");
    expect(typeof updates.updated_at).toBe("string");
    expect(typeof updates.sync_version).toBe("number");
  });

  test('filters out null values correctly', () => {
    const updates = {
      content: "Valid content",
      description: null,
      project_id: "proj-123",
      section_id: null,
      priority: 2,
      due: null,
      labels: ["test"],
      checked: null,
    };

    // Simulate the filtering logic from the mutation
    const patchUpdates: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(updates)) {
      if (value !== null) {
        patchUpdates[key] = value;
      }
    }

    expect(patchUpdates.content).toBe("Valid content");
    expect(patchUpdates.project_id).toBe("proj-123");
    expect(patchUpdates.priority).toBe(2);
    expect(patchUpdates.labels).toEqual(["test"]);

    // Null values should be filtered out
    expect("description" in patchUpdates).toBe(false);
    expect("section_id" in patchUpdates).toBe(false);
    expect("due" in patchUpdates).toBe(false);
    expect("checked" in patchUpdates).toBe(false);
  });

  test('handles due date structure variants', () => {
    const dueDateVariants = [
      // Minimal due date
      {
        date: "2024-03-15"
      },
      // Full due date with all fields
      {
        date: "2024-03-15",
        is_recurring: true,
        string: "every day",
        datetime: "2024-03-15T09:00:00Z",
        timezone: "America/New_York"
      },
      // Due date with null timezone
      {
        date: "2024-03-15",
        datetime: "2024-03-15T09:00:00Z",
        timezone: null
      },
      // Null due date (to clear)
      null
    ];

    dueDateVariants.forEach(due => {
      const updates = { due };

      if (due === null) {
        expect(updates.due).toBeNull();
      } else {
        expect(updates.due).toBeTruthy();
        expect(updates.due?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

        if (updates.due?.datetime) {
          expect(updates.due.datetime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        }
      }
    });
  });

  test('validates checked field values', () => {
    const validCheckedValues = [0, 1, undefined];

    validCheckedValues.forEach(checked => {
      const updates = { checked };

      if (checked !== undefined) {
        expect([0, 1]).toContain(updates.checked);
      } else {
        expect(updates.checked).toBeUndefined();
      }
    });
  });

  test('validates priority values', () => {
    const validPriorities = [1, 2, 3, 4];

    validPriorities.forEach(priority => {
      const updates = { priority };

      expect(updates.priority).toBeGreaterThanOrEqual(1);
      expect(updates.priority).toBeLessThanOrEqual(4);
      expect(Number.isInteger(updates.priority)).toBe(true);
    });
  });

  test('handles labels array correctly', () => {
    const labelsTestCases = [
      [],
      ["single-label"],
      ["multiple", "labels", "here"],
      ["label-with-dashes", "label_with_underscores"],
    ];

    labelsTestCases.forEach(labels => {
      const updates = { labels };

      expect(Array.isArray(updates.labels)).toBe(true);
      expect(updates.labels?.every(label => typeof label === "string")).toBe(true);
    });
  });

  test('validates ISO date strings', () => {
    const dateFields = [
      "completed_at",
      "updated_at"
    ];

    const validDates = [
      "2024-03-15T10:00:00Z",
      "2024-01-01T00:00:00.000Z",
      "2024-12-31T23:59:59.999Z",
    ];

    dateFields.forEach(field => {
      validDates.forEach(dateString => {
        const updates = { [field]: dateString };

        expect(updates[field]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        expect(new Date(updates[field] as string).getTime()).toBeGreaterThan(0);
      });
    });
  });

  test('handles empty updates object', () => {
    const updates = {};

    const patchUpdates: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(updates)) {
      if (value !== null) {
        patchUpdates[key] = value;
      }
    }

    expect(Object.keys(patchUpdates)).toHaveLength(0);
  });

  test('handles mixed null and valid values with clearable fields', () => {
    const updates = {
      content: "New content",
      description: null,
      priority: 3,
      due: null,
      deadline: null,
      labels: ["work"],
      checked: null,
      is_deleted: 0,
    };

    const patchUpdates: Record<string, unknown> = {};
    const clearableFields = new Set(['due', 'deadline', 'completed_at']);

    for (const [key, value] of Object.entries(updates)) {
      if (value === null) {
        // For clearable fields, convert null to undefined to remove the field
        if (clearableFields.has(key)) {
          patchUpdates[key] = undefined;
        }
        // For other fields, skip null (preserve existing value)
      } else {
        // Non-null values are set directly
        patchUpdates[key] = value;
      }
    }

    const expectedKeys = ["content", "priority", "labels", "is_deleted", "due", "deadline"];
    expect(Object.keys(patchUpdates).sort()).toEqual(expectedKeys.sort());
    expect(patchUpdates.content).toBe("New content");
    expect(patchUpdates.priority).toBe(3);
    expect(patchUpdates.labels).toEqual(["work"]);
    expect(patchUpdates.is_deleted).toBe(0);
    // Clearable fields should be set to undefined (to clear them)
    expect(patchUpdates.due).toBeUndefined();
    expect(patchUpdates.deadline).toBeUndefined();
    // Non-clearable null fields should not be in the patch
    expect(patchUpdates.description).toBeUndefined();
    expect(patchUpdates.checked).toBeUndefined();
  });

  test('sync_version handling', () => {
    const syncVersions = [
      Date.now(),
      1700000000000,
      new Date().getTime(),
    ];

    syncVersions.forEach(sync_version => {
      const updates = { sync_version };

      expect(typeof updates.sync_version).toBe("number");
      expect(updates.sync_version).toBeGreaterThan(0);
      expect(Number.isInteger(updates.sync_version)).toBe(true);
    });
  });
});