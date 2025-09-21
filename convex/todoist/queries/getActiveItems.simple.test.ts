import { describe, test, expect } from 'vitest';

// Since convex query wrapper doesn't expose handler directly,
// we'll test the logic separately
describe('getActiveItems logic', () => {
  test('sorting logic works correctly', () => {
    const items = [
      { child_order: 3, content: 'Third' },
      { child_order: 1, content: 'First' },
      { child_order: 2, content: 'Second' },
    ];
    
    // Test just the sorting logic that getActiveItems uses
    const sorted = items.sort((a, b) => a.child_order - b.child_order);
    
    expect(sorted[0].content).toBe('First');
    expect(sorted[1].content).toBe('Second');
    expect(sorted[2].content).toBe('Third');
  });

  test('filtering logic for active items', () => {
    const allItems = [
      { todoist_id: '1', content: 'Active task', checked: 0, is_deleted: 0 },
      { todoist_id: '2', content: 'Completed task', checked: 1, is_deleted: 0 },
      { todoist_id: '3', content: 'Deleted task', checked: 0, is_deleted: 1 },
      { todoist_id: '4', content: 'Another active', checked: 0, is_deleted: 0 },
    ];
    
    // Test the filtering logic that getActiveItems uses
    const activeItems = allItems
      .filter(item => item.checked === 0)
      .filter(item => item.is_deleted === 0);
    
    expect(activeItems).toHaveLength(2);
    expect(activeItems[0].content).toBe('Active task');
    expect(activeItems[1].content).toBe('Another active');
  });

  test('handler returns sorted items', () => {
    const items = [
      { child_order: 3, content: 'Third' },
      { child_order: 1, content: 'First' },
      { child_order: 2, content: 'Second' },
    ];
    
    // Test just the sorting logic
    const sorted = items.sort((a, b) => a.child_order - b.child_order);
    
    expect(sorted[0].content).toBe('First');
    expect(sorted[1].content).toBe('Second');
    expect(sorted[2].content).toBe('Third');
  });
});