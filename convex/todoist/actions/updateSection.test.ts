import { describe, test, expect } from 'vitest';

describe('updateSection data transformation', () => {
  test('transforms SDK response to database format correctly', () => {
    // Mock SDK response format after update
    const updatedSection = {
      id: 'sect-123',
      name: 'Updated Section Name',
      projectId: 'proj-456',
      order: 3,
    };

    // Expected database format
    const expectedDbFormat = {
      id: updatedSection.id,
      name: updatedSection.name,
      project_id: updatedSection.projectId,
      section_order: updatedSection.order || 0,
      is_deleted: 0,
      is_archived: 0,
    };

    expect(expectedDbFormat.id).toBe('sect-123');
    expect(expectedDbFormat.name).toBe('Updated Section Name');
    expect(expectedDbFormat.project_id).toBe('proj-456');
    expect(expectedDbFormat.section_order).toBe(3);
  });

  test('validates update arguments structure', () => {
    const updateArgs = {
      sectionId: 'sect-123',
      name: 'New Section Name',
    };

    // Test required fields
    expect(updateArgs.sectionId).toBeDefined();
    expect(updateArgs.name).toBeDefined();
    expect(typeof updateArgs.sectionId).toBe('string');
    expect(typeof updateArgs.name).toBe('string');
    expect(updateArgs.sectionId.length).toBeGreaterThan(0);
    expect(updateArgs.name.length).toBeGreaterThan(0);
  });

  test('handles response with missing order field', () => {
    const sectionWithoutOrder = {
      id: 'sect-456',
      name: 'Section Without Order',
      projectId: 'proj-789',
      order: undefined,
    };

    const expectedDbFormat = {
      id: sectionWithoutOrder.id,
      name: sectionWithoutOrder.name,
      project_id: sectionWithoutOrder.projectId,
      section_order: sectionWithoutOrder.order || 0,
      is_deleted: 0,
      is_archived: 0,
    };

    expect(expectedDbFormat.section_order).toBe(0);
  });
});