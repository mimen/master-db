export function createMockProject(overrides = {}) {
  return {
    todoist_id: 'project-123',
    name: 'Test Project',
    color: 'blue',
    parent_id: undefined,
    child_order: 1,
    is_deleted: false,
    is_archived: false,
    is_favorite: false,
    view_style: 'list',
    sync_version: 1,
    ...overrides,
  };
}