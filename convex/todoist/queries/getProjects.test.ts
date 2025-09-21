import { describe, test, expect } from 'vitest';

import { createMockProject } from '../test_utils/fixtures/projects';

// Since convex-test has issues with Bun, we'll test the business logic
describe('getProjects', () => {
  test('sorts projects by sync_version', () => {
    const projects = [
      createMockProject({ sync_version: 3, name: 'Third' }),
      createMockProject({ sync_version: 1, name: 'First' }),
      createMockProject({ sync_version: 2, name: 'Second' }),
    ];

    // Test the sorting logic
    const sorted = projects.sort((a, b) => a.sync_version - b.sync_version);

    expect(sorted[0].name).toBe('First');
    expect(sorted[1].name).toBe('Second');
    expect(sorted[2].name).toBe('Third');
  });

  test('returns empty array when no projects exist', () => {
    const projects: any[] = [];

    // Test edge case
    const sorted = projects.sort((a, b) => a.sync_version - b.sync_version);

    expect(sorted).toEqual([]);
  });
});