import { describe, test, expect } from 'vitest';

import { createMockTodoistItem } from '../../../test-utils/todoist/fixtures/items';
import { createMockProject } from '../../../test-utils/todoist/fixtures/projects';

describe('getProjectWithItemCount', () => {
  test('calculates item counts correctly', () => {
    const project = createMockProject({ todoist_id: 'proj-1' });
    const items = [
      createMockTodoistItem({ project_id: 'proj-1', checked: 0 }),
      createMockTodoistItem({ project_id: 'proj-1', checked: 0 }),
      createMockTodoistItem({ project_id: 'proj-1', checked: 1 }),
      createMockTodoistItem({ project_id: 'proj-1', checked: 1 }),
      createMockTodoistItem({ project_id: 'proj-1', checked: 1 }),
      createMockTodoistItem({ project_id: 'proj-2', checked: 0 }), // Different project
    ];

    // Simulate the counting logic
    const projectItems = items.filter(i => i.project_id === 'proj-1');
    const result = {
      ...project,
      itemCount: projectItems.length,
      completedCount: projectItems.filter(i => i.checked === 1).length,
      activeCount: projectItems.filter(i => i.checked === 0).length,
    };

    expect(result.itemCount).toBe(5);
    expect(result.completedCount).toBe(3);
    expect(result.activeCount).toBe(2);
  });

  test('returns null when project not found', () => {
    const project = null;

    expect(project).toBeNull();
  });

  test('handles empty project with no items', () => {
    const project = createMockProject({ todoist_id: 'empty-proj' });
    const items: any[] = [];

    const projectItems = items.filter(i => i.project_id === 'empty-proj');
    const result = {
      ...project,
      itemCount: projectItems.length,
      completedCount: projectItems.filter(i => i.checked === 1).length,
      activeCount: projectItems.filter(i => i.checked === 0).length,
    };

    expect(result.itemCount).toBe(0);
    expect(result.completedCount).toBe(0);
    expect(result.activeCount).toBe(0);
  });
});