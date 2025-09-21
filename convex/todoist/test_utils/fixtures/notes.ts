export function createMockNote(overrides = {}) {
  return {
    todoist_id: 'note-123',
    item_id: 'item-123',
    content: 'Test note content',
    posted_at: new Date().toISOString(),
    posted_uid: 'user-123',
    is_deleted: 0,
    sync_version: Date.now(),
    ...overrides,
  };
}