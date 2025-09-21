export function createMockProject(overrides = {}) {
  return {
    todoist_id: 'project-123',
    name: 'Test Project',
    color: 'blue',
    parent_id: undefined,
    child_order: 1,
    is_deleted: 0,
    is_archived: 0,
    is_favorite: 0,
    view_style: 'list',
    sync_version: 1,
    ...overrides,
  };
}