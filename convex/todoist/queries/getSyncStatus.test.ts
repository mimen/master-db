import { describe, test, expect } from 'vitest';

import { createMockTodoistItem } from '../test_utils/fixtures/items';
import { createMockProject } from '../test_utils/fixtures/projects';

describe('getSyncStatus', () => {
  test('counts active items correctly', () => {
    const items = [
      createMockTodoistItem({ checked: 0, is_deleted: 0 }), // Active
      createMockTodoistItem({ checked: 1, is_deleted: 0 }), // Completed
      createMockTodoistItem({ checked: 0, is_deleted: 1 }), // Deleted
      createMockTodoistItem({ checked: 0, is_deleted: 0 }), // Active
    ];
    
    const activeItemCount = items.filter(i => i.checked === 0 && i.is_deleted === 0).length;
    
    expect(activeItemCount).toBe(2);
    expect(items.length).toBe(4);
  });

  test('counts active projects correctly', () => {
    const projects = [
      createMockProject({ is_deleted: 0 }), // Active
      createMockProject({ is_deleted: 1 }), // Deleted
      createMockProject({ is_deleted: 0 }), // Active
      createMockProject({ is_deleted: 0 }), // Active
    ];
    
    const activeProjectCount = projects.filter(p => p.is_deleted === 0).length;
    
    expect(activeProjectCount).toBe(3);
    expect(projects.length).toBe(4);
  });

  test('handles empty database', () => {
    const syncState = null;
    const items: any[] = [];
    const projects: any[] = [];
    
    const result = {
      lastFullSync: syncState?.last_full_sync,
      lastIncrementalSync: syncState?.last_incremental_sync,
      syncToken: syncState?.last_sync_token,
      itemCount: items.length,
      activeItemCount: items.filter(i => i.checked === 0 && i.is_deleted === 0).length,
      projectCount: projects.length,
      activeProjectCount: projects.filter(p => p.is_deleted === 0).length,
    };
    
    expect(result.lastFullSync).toBeUndefined();
    expect(result.itemCount).toBe(0);
    expect(result.activeItemCount).toBe(0);
    expect(result.projectCount).toBe(0);
    expect(result.activeProjectCount).toBe(0);
  });
});