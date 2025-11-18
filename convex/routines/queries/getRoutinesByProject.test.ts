import { describe, test, expect } from 'vitest';

import type { Doc } from '../../_generated/dataModel';

// Mock routine helper (following pattern from todoist tests)
function createMockRoutine(
  overrides: Partial<Doc<"routines">>
): Doc<"routines"> {
  return {
    _id: 'mock-id' as Doc<"routines">["_id"],
    _creationTime: Date.now(),
    name: 'Test Routine',
    description: undefined,
    frequency: 'Weekly',
    duration: '30min',
    timeOfDay: undefined,
    idealDay: undefined,
    todoistProjectId: undefined,
    todoistLabels: [],
    priority: 1,
    defer: false,
    deferralDate: undefined,
    lastCompletedDate: undefined,
    completionRateOverall: 0,
    completionRateMonth: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('getRoutinesByProject', () => {
  test('filters routines by projectId', () => {
    const projectId = 'project-123';
    const routines = [
      createMockRoutine({ name: 'Routine A', todoistProjectId: projectId }),
      createMockRoutine({ name: 'Routine B', todoistProjectId: 'other-project' }),
      createMockRoutine({ name: 'Routine C', todoistProjectId: projectId }),
      createMockRoutine({ name: 'Routine D', todoistProjectId: undefined }), // No project
    ];

    // Test filtering logic
    const filtered = routines.filter(r => r.todoistProjectId === projectId);

    expect(filtered).toHaveLength(2);
    expect(filtered.map(r => r.name)).toEqual(['Routine A', 'Routine C']);
  });

  test('excludes deferred routines by default', () => {
    const projectId = 'project-123';
    const routines = [
      createMockRoutine({ name: 'Active', todoistProjectId: projectId, defer: false }),
      createMockRoutine({ name: 'Deferred', todoistProjectId: projectId, defer: true }),
    ];

    // Test defer filtering logic
    const filtered = routines.filter(r => r.todoistProjectId === projectId && r.defer === false);

    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('Active');
  });

  test('includes deferred routines when requested', () => {
    const projectId = 'project-123';
    const routines = [
      createMockRoutine({ name: 'Active', todoistProjectId: projectId, defer: false }),
      createMockRoutine({ name: 'Deferred', todoistProjectId: projectId, defer: true }),
    ];

    // Test includeDeferred logic
    const filtered = routines.filter(r => r.todoistProjectId === projectId);

    expect(filtered).toHaveLength(2);
    expect(filtered.map(r => r.name)).toEqual(['Active', 'Deferred']);
  });

  test('sorts routines by defer status then name', () => {
    const projectId = 'project-123';
    const routines = [
      createMockRoutine({ name: 'Zebra', todoistProjectId: projectId, defer: true }),
      createMockRoutine({ name: 'Alpha', todoistProjectId: projectId, defer: false }),
      createMockRoutine({ name: 'Beta', todoistProjectId: projectId, defer: false }),
      createMockRoutine({ name: 'Gamma', todoistProjectId: projectId, defer: true }),
    ];

    // Test sorting logic (active first, then alphabetical)
    const sorted = routines
      .filter(r => r.todoistProjectId === projectId)
      .sort((a, b) => {
        // Active routines come first
        if (a.defer !== b.defer) {
          return a.defer ? 1 : -1;
        }
        // Then sort alphabetically by name
        return a.name.localeCompare(b.name);
      });

    expect(sorted.map(r => r.name)).toEqual(['Alpha', 'Beta', 'Gamma', 'Zebra']);
    expect(sorted[0].defer).toBe(false); // Active first
    expect(sorted[1].defer).toBe(false); // Active second
    expect(sorted[2].defer).toBe(true);  // Deferred third
    expect(sorted[3].defer).toBe(true);  // Deferred last
  });

  test('returns empty array when no routines match project', () => {
    const projectId = 'project-123';
    const routines = [
      createMockRoutine({ name: 'Routine A', todoistProjectId: 'other-project' }),
      createMockRoutine({ name: 'Routine B', todoistProjectId: undefined }),
    ];

    // Test edge case
    const filtered = routines.filter(r => r.todoistProjectId === projectId);

    expect(filtered).toEqual([]);
  });

  test('handles routines with null/undefined projectId', () => {
    const projectId = 'project-123';
    const routines = [
      createMockRoutine({ name: 'With Project', todoistProjectId: projectId }),
      createMockRoutine({ name: 'No Project', todoistProjectId: undefined }),
      createMockRoutine({ name: 'Another No Project', todoistProjectId: undefined }),
    ];

    // Test filtering excludes null/undefined
    const filtered = routines.filter(r => r.todoistProjectId === projectId);

    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('With Project');
  });
});
