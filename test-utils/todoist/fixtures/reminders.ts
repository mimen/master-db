export function createMockReminder(overrides = {}) {
  return {
    todoist_id: 'reminder-123',
    item_id: 'item-123',
    type: 'absolute',
    due_date: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
    is_deleted: 0,
    sync_version: Date.now(),
    ...overrides,
  };
}