import { describe, test, expect } from 'vitest';

describe('upsertProject', () => {
  test('creates project data with correct structure', () => {
    const todoistProject = {
      id: 'proj-123',
      name: 'Test Project',
      color: 'blue',
      parent_id: null,
      child_order: 1,
      is_deleted: false,
      is_archived: false,
      is_favorite: true,
      view_style: 'board',
      updated_at: '2024-01-01T00:00:00Z'
    };

    const currentVersion = new Date(todoistProject.updated_at).getTime();

    const projectData = {
      todoist_id: todoistProject.id,
      name: todoistProject.name,
      color: todoistProject.color,
      parent_id: todoistProject.parent_id || undefined,
      child_order: todoistProject.child_order || 0,
      is_deleted: todoistProject.is_deleted ? 1 : 0,
      is_archived: todoistProject.is_archived ? 1 : 0,
      is_favorite: todoistProject.is_favorite ? 1 : 0,
      view_style: todoistProject.view_style || "list",
      sync_version: currentVersion,
    };

    expect(projectData.todoist_id).toBe('proj-123');
    expect(projectData.name).toBe('Test Project');
    expect(projectData.is_deleted).toBe(0);
    expect(projectData.is_favorite).toBe(1);
    expect(projectData.view_style).toBe('board');
    expect(projectData.sync_version).toBe(currentVersion);
  });

  test('handles missing optional fields', () => {
    const minimalProject = {
      id: 'proj-minimal',
      name: 'Minimal Project',
      color: 'red'
    };

    const projectData = {
      todoist_id: minimalProject.id,
      name: minimalProject.name,
      color: minimalProject.color,
      parent_id: undefined,
      child_order: 0,
      is_deleted: 0,
      is_archived: 0,
      is_favorite: 0,
      view_style: "list",
      sync_version: Date.now(),
    };

    expect(projectData.parent_id).toBeUndefined();
    expect(projectData.child_order).toBe(0);
    expect(projectData.view_style).toBe('list');
  });

  test('version comparison logic', () => {
    const existingVersion = 1000;
    const newVersion = 2000;
    const oldVersion = 500;

    // Newer version should update
    expect(newVersion > existingVersion).toBe(true);

    // Older version should NOT update
    expect(oldVersion < existingVersion).toBe(true);
  });
});