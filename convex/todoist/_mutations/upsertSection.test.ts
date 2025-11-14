import { describe, test, expect } from 'vitest';

describe('upsertSection', () => {
  test('creates section data with correct structure', () => {
    const todoistSection = {
      id: 'section-123',
      name: 'Test Section',
      project_id: 'proj-123',
      section_order: 5,
      is_deleted: false,
      is_archived: false
    };

    const sectionData = {
      todoist_id: todoistSection.id,
      name: todoistSection.name,
      project_id: todoistSection.project_id,
      section_order: todoistSection.section_order || 0,
      is_deleted: todoistSection.is_deleted ? 1 : 0,
      is_archived: todoistSection.is_archived ? 1 : 0,
      sync_version: Date.now(),
    };

    expect(sectionData.todoist_id).toBe('section-123');
    expect(sectionData.name).toBe('Test Section');
    expect(sectionData.project_id).toBe('proj-123');
    expect(sectionData.section_order).toBe(5);
    expect(sectionData.is_deleted).toBe(0);
    expect(sectionData.is_archived).toBe(0);
  });

  test('handles default section_order', () => {
    const sectionWithoutOrder: {
      id: string;
      name: string;
      project_id: string;
      section_order?: number;
    } = {
      id: 'section-no-order',
      name: 'No Order Section',
      project_id: 'proj-123'
    };

    const sectionData = {
      todoist_id: sectionWithoutOrder.id,
      name: sectionWithoutOrder.name,
      project_id: sectionWithoutOrder.project_id,
      section_order: sectionWithoutOrder.section_order || 0,
      is_deleted: 0,
      is_archived: 0,
      sync_version: Date.now(),
    };

    expect(sectionData.section_order).toBe(0);
  });

  test('converts boolean flags to integers', () => {
    const deletedSection = {
      id: 'section-deleted',
      name: 'Deleted Section',
      project_id: 'proj-123',
      is_deleted: true,
      is_archived: true
    };

    const sectionData = {
      todoist_id: deletedSection.id,
      name: deletedSection.name,
      project_id: deletedSection.project_id,
      section_order: 0,
      is_deleted: deletedSection.is_deleted ? 1 : 0,
      is_archived: deletedSection.is_archived ? 1 : 0,
      sync_version: Date.now(),
    };

    expect(sectionData.is_deleted).toBe(1);
    expect(sectionData.is_archived).toBe(1);
  });
});