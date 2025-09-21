export function createMockSection(overrides = {}) {
  return {
    todoist_id: 'section-123',
    name: 'Test Section',
    project_id: 'project-123',
    section_order: 0,
    is_deleted: 0,
    is_archived: 0,
    sync_version: Date.now(),
    ...overrides,
  };
}