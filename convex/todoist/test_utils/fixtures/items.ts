export function createMockTodoistItem(overrides = {}) {
  return {
    todoist_id: '123',
    content: 'Test task',
    description: '',
    project_id: 'inbox',
    section_id: undefined,
    parent_id: undefined,
    child_order: 1,
    priority: 1,
    due: undefined,
    labels: [],
    assignee_id: undefined,
    assigner_id: undefined,
    comment_count: 0,
    checked: 0,
    is_deleted: 0,
    added_at: new Date().toISOString(),
    completed_at: undefined,
    user_id: 'test-user',
    sync_version: 1,
    ...overrides,
  };
}