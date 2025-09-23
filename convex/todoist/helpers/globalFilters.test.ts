import { describe, test, expect } from "vitest";

import { Doc } from "../../_generated/dataModel";

import { applyGlobalFilters, TodoistFilterBuilder, SYSTEM_EXCLUDED_LABELS } from "./globalFilters";

// Helper to create mock Todoist items
function createMockItem(overrides: Partial<Doc<"todoist_items">>): Doc<"todoist_items"> {
  return {
    _id: "test-id" as Doc<"todoist_items">["_id"],
    _creationTime: Date.now(),
    todoist_id: "123",
    content: "Test task",
    project_id: "proj-1",
    child_order: 1,
    priority: 1,
    labels: [],
    comment_count: 0,
    checked: false,
    is_deleted: false,
    added_at: new Date().toISOString(),
    user_id: "user-1",
    sync_version: 1,
    ...overrides
  };
}

describe('applyGlobalFilters', () => {
  describe('star prefix filtering', () => {
    test('excludes star prefix tasks by default', () => {
      const items = [
        createMockItem({ content: '* Project metadata' }),
        createMockItem({ content: 'Regular task' }),
        createMockItem({ content: '* Another metadata task' }),
      ];

      const filtered = applyGlobalFilters(items);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].content).toBe('Regular task');
    });

    test('includes star prefix tasks when includeStarPrefix is true', () => {
      const items = [
        createMockItem({ content: '* Project metadata' }),
        createMockItem({ content: 'Regular task' }),
      ];

      const filtered = applyGlobalFilters(items, { includeStarPrefix: true });

      expect(filtered).toHaveLength(2);
    });
  });

  describe('completed items filtering', () => {
    test('excludes completed items by default', () => {
      const items = [
        createMockItem({ checked: false }),
        createMockItem({ checked: true }),
        createMockItem({ checked: false }),
      ];

      const filtered = applyGlobalFilters(items);

      expect(filtered).toHaveLength(2);
      expect(filtered.every(item => item.checked === false)).toBe(true);
    });

    test('includes completed items when includeCompleted is true', () => {
      const items = [
        createMockItem({ checked: false }),
        createMockItem({ checked: true }),
      ];

      const filtered = applyGlobalFilters(items, { includeCompleted: true });

      expect(filtered).toHaveLength(2);
    });
  });

  describe('system labels filtering', () => {
    test('excludes all system labels', () => {
      const items = [
        createMockItem({ labels: ['area-of-responsibility'] }),
        createMockItem({ labels: ['project-type'] }),
        createMockItem({ labels: ['project-metadata'] }),
        createMockItem({ labels: ['normal-label'] }),
        createMockItem({ labels: ['urgent', 'project-metadata'] }),
      ];

      const filtered = applyGlobalFilters(items);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].labels).toEqual(['normal-label']);
    });

    test('system excluded labels constant matches expected values', () => {
      expect(SYSTEM_EXCLUDED_LABELS).toEqual([
        'area-of-responsibility',
        'project-type',
        'project-metadata'
      ]);
    });
  });

  describe('assignee filtering', () => {
    const currentUserId = 'user-123';

    test('default filter excludes tasks assigned to others', () => {
      const items = [
        createMockItem({ assignee_id: undefined }),
        createMockItem({ assignee_id: currentUserId }),
        createMockItem({ assignee_id: 'other-user' }),
      ];

      const filtered = applyGlobalFilters(items, { currentUserId });

      expect(filtered).toHaveLength(2);
      expect(filtered.some(item => item.assignee_id === 'other-user')).toBe(false);
    });

    test('all filter includes everything', () => {
      const items = [
        createMockItem({ assignee_id: undefined }),
        createMockItem({ assignee_id: currentUserId }),
        createMockItem({ assignee_id: 'other-user' }),
      ];

      const filtered = applyGlobalFilters(items, {
        assigneeFilter: 'all',
        currentUserId
      });

      expect(filtered).toHaveLength(3);
    });

    test('unassigned filter only includes unassigned tasks', () => {
      const items = [
        createMockItem({ assignee_id: undefined }),
        createMockItem({ assignee_id: currentUserId }),
        createMockItem({ assignee_id: 'other-user' }),
      ];

      const filtered = applyGlobalFilters(items, {
        assigneeFilter: 'unassigned',
        currentUserId
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].assignee_id).toBeUndefined();
    });

    test('assigned-to-me filter only includes tasks assigned to current user', () => {
      const items = [
        createMockItem({ assignee_id: undefined }),
        createMockItem({ assignee_id: currentUserId }),
        createMockItem({ assignee_id: 'other-user' }),
      ];

      const filtered = applyGlobalFilters(items, {
        assigneeFilter: 'assigned-to-me',
        currentUserId
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].assignee_id).toBe(currentUserId);
    });

    test('assigned-to-others filter only includes tasks assigned to other users', () => {
      const items = [
        createMockItem({ assignee_id: undefined }),
        createMockItem({ assignee_id: currentUserId }),
        createMockItem({ assignee_id: 'other-user' }),
      ];

      const filtered = applyGlobalFilters(items, {
        assigneeFilter: 'assigned-to-others',
        currentUserId
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].assignee_id).toBe('other-user');
    });
  });

  describe('combined filters', () => {
    test('applies all filters together', () => {
      const items = [
        createMockItem({ content: '* Metadata', checked: false }),
        createMockItem({ content: 'Task 1', checked: true }),
        createMockItem({ content: 'Task 2', labels: ['project-metadata'] }),
        createMockItem({ content: 'Task 3', assignee_id: 'other-user' }),
        createMockItem({ content: 'Good task', assignee_id: 'user-123' }),
      ];

      const filtered = applyGlobalFilters(items, {
        currentUserId: 'user-123'
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].content).toBe('Good task');
    });
  });
});

describe('TodoistFilterBuilder', () => {
  test('chains multiple filters correctly', () => {
    const items = [
      createMockItem({ content: '* Metadata', labels: ['urgent'] }),
      createMockItem({ content: 'Task 1', checked: true }),
      createMockItem({ content: 'Task 2', labels: ['excluded'] }),
      createMockItem({ content: 'Good task' }),
    ];

    const filter = new TodoistFilterBuilder()
      .excludeStarPrefix()
      .excludeCompleted()
      .excludeLabels(['excluded'])
      .build();

    const filtered = items.filter(filter);

    expect(filtered).toHaveLength(1);
    expect(filtered[0].content).toBe('Good task');
  });

  test('assignee filter works in builder', () => {
    const items = [
      createMockItem({ assignee_id: undefined }),
      createMockItem({ assignee_id: 'user-123' }),
      createMockItem({ assignee_id: 'other-user' }),
    ];

    const filter = new TodoistFilterBuilder()
      .filterByAssignee('assigned-to-me', 'user-123')
      .build();

    const filtered = items.filter(filter);

    expect(filtered).toHaveLength(1);
    expect(filtered[0].assignee_id).toBe('user-123');
  });
});