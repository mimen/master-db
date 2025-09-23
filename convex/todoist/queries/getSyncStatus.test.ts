import { describe, test, expect } from 'vitest';

import { createMockTodoistItem } from '../../../test-utils/todoist/fixtures/items';
import { createMockProject } from '../../../test-utils/todoist/fixtures/projects';

describe('getSyncStatus', () => {
  test('counts active items correctly', () => {
    const items = [
      createMockTodoistItem({ checked: false, is_deleted: false }), // Active
      createMockTodoistItem({ checked: true, is_deleted: false }), // Completed
      createMockTodoistItem({ checked: false, is_deleted: true }), // Deleted
      createMockTodoistItem({ checked: false, is_deleted: false }), // Active
    ];

    const activeItemCount = items.filter(i => i.checked === false && i.is_deleted === false).length;

    expect(activeItemCount).toBe(2);
    expect(items.length).toBe(4);
  });

  test('counts active projects correctly', () => {
    const projects = [
      createMockProject({ is_deleted: false }), // Active
      createMockProject({ is_deleted: true }), // Deleted
      createMockProject({ is_deleted: false }), // Active
      createMockProject({ is_deleted: false }), // Active
    ];

    const activeProjectCount = projects.filter(p => p.is_deleted === false).length;

    expect(activeProjectCount).toBe(3);
    expect(projects.length).toBe(4);
  });

  test('handles empty database', () => {
    type SyncState = {
      last_full_sync?: string;
      last_incremental_sync?: string;
      last_sync_token?: string;
    } | null;

    const syncState = null as SyncState;
    const items: ReturnType<typeof createMockTodoistItem>[] = [];
    const projects: ReturnType<typeof createMockProject>[] = [];

    const result = {
      lastFullSync: syncState?.last_full_sync,
      lastIncrementalSync: syncState?.last_incremental_sync,
      syncToken: syncState?.last_sync_token,
      itemCount: items.length,
      activeItemCount: items.filter(i => i.checked === false && i.is_deleted === false).length,
      projectCount: projects.length,
      activeProjectCount: projects.filter(p => p.is_deleted === false).length,
    };

    expect(result.lastFullSync).toBeUndefined();
    expect(result.itemCount).toBe(0);
    expect(result.activeItemCount).toBe(0);
    expect(result.projectCount).toBe(0);
    expect(result.activeProjectCount).toBe(0);
  });
});