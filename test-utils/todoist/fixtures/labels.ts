export function createMockLabel(overrides = {}) {
  return {
    todoist_id: 'label-123',
    name: 'test-label',
    color: 'blue',
    item_order: 0,
    is_deleted: 0,
    is_favorite: 0,
    sync_version: Date.now(),
    ...overrides,
  };
}