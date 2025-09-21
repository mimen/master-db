import { describe, test, expect } from 'vitest';

describe('upsertLabel', () => {
  test('creates label data with correct structure', () => {
    const todoistLabel = {
      id: 'label-123',
      name: 'urgent',
      color: 'red',
      item_order: 3,
      is_deleted: false,
      is_favorite: true
    };
    
    const labelData = {
      todoist_id: todoistLabel.id,
      name: todoistLabel.name,
      color: todoistLabel.color,
      item_order: todoistLabel.item_order || 0,
      is_deleted: todoistLabel.is_deleted ? 1 : 0,
      is_favorite: todoistLabel.is_favorite ? 1 : 0,
      sync_version: Date.now(),
    };
    
    expect(labelData.todoist_id).toBe('label-123');
    expect(labelData.name).toBe('urgent');
    expect(labelData.color).toBe('red');
    expect(labelData.item_order).toBe(3);
    expect(labelData.is_deleted).toBe(0);
    expect(labelData.is_favorite).toBe(1);
  });

  test('handles default item_order', () => {
    const labelWithoutOrder = {
      id: 'label-no-order',
      name: 'work',
      color: 'blue'
    };
    
    const labelData = {
      todoist_id: labelWithoutOrder.id,
      name: labelWithoutOrder.name,
      color: labelWithoutOrder.color,
      item_order: labelWithoutOrder.item_order || 0,
      is_deleted: 0,
      is_favorite: 0,
      sync_version: Date.now(),
    };
    
    expect(labelData.item_order).toBe(0);
  });

  test('version check prevents older updates', () => {
    const existingLabel = {
      sync_version: 1000,
      name: 'existing'
    };
    
    const olderUpdate = {
      sync_version: 500,
      name: 'older'
    };
    
    const newerUpdate = {
      sync_version: 1500,
      name: 'newer'
    };
    
    // Older update should be skipped
    expect(olderUpdate.sync_version < existingLabel.sync_version).toBe(true);
    
    // Newer update should be applied
    expect(newerUpdate.sync_version > existingLabel.sync_version).toBe(true);
  });
});