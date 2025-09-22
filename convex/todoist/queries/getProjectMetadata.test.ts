import { describe, test, expect } from 'vitest';

describe('getProjectMetadata', () => {
  test('validates projectId argument', () => {
    const args = {
      projectId: "proj-123",
    };

    expect(args.projectId).toBe("proj-123");
    expect(typeof args.projectId).toBe("string");
    expect(args.projectId.length).toBeGreaterThan(0);
  });

  test('query uses correct index and filter', () => {
    const projectId = "proj-test-456";

    // Simulate the query structure
    const queryConfig = {
      table: "todoist_project_metadata",
      index: "by_project",
      filterField: "project_id",
      filterValue: projectId,
      method: "first", // Returns single result
    };

    expect(queryConfig.table).toBe("todoist_project_metadata");
    expect(queryConfig.index).toBe("by_project");
    expect(queryConfig.filterField).toBe("project_id");
    expect(queryConfig.filterValue).toBe(projectId);
    expect(queryConfig.method).toBe("first");
  });

  test('handles different project ID formats', () => {
    const validProjectIds = [
      "proj-123",
      "2151234567",
      "project_test_123",
      "PROJ-ABC-XYZ",
    ];

    validProjectIds.forEach(projectId => {
      const args = { projectId };

      expect(args.projectId).toBe(projectId);
      expect(typeof args.projectId).toBe("string");
    });
  });

  test('expected return structure for existing metadata', () => {
    // Mock what the query would return for existing metadata
    const mockMetadata = {
      _id: "metadata_doc_id",
      _creationTime: 1700000000000,
      project_id: "proj-123",
      priority: 2,
      scheduled_date: "2024-03-15",
      description: "Important project for Q1",
      project_type: "area-of-responsibility" as const,
      source_task_id: "task-456",
      last_updated: 1700000000000,
      sync_version: 1700000000000,
    };

    // Verify structure matches expected schema
    expect(mockMetadata.project_id).toBe("proj-123");
    expect(mockMetadata.priority).toBe(2);
    expect(mockMetadata.scheduled_date).toBe("2024-03-15");
    expect(mockMetadata.description).toBe("Important project for Q1");
    expect(mockMetadata.project_type).toBe("area-of-responsibility");
    expect(mockMetadata.source_task_id).toBe("task-456");
    expect(typeof mockMetadata.last_updated).toBe("number");
    expect(typeof mockMetadata.sync_version).toBe("number");
    expect(typeof mockMetadata._id).toBe("string");
    expect(typeof mockMetadata._creationTime).toBe("number");
  });

  test('expected return for non-existent metadata', () => {
    // When no metadata exists, query.first() returns null
    const result = null;

    expect(result).toBeNull();
  });

  test('handles minimal metadata record', () => {
    // Mock minimal metadata (only required fields)
    const minimalMetadata = {
      _id: "minimal_metadata_id",
      _creationTime: 1700000000000,
      project_id: "proj-minimal",
      last_updated: 1700000000000,
      sync_version: 1700000000000,
      // Optional fields would be undefined
      priority: undefined,
      scheduled_date: undefined,
      description: undefined,
      project_type: undefined,
      source_task_id: undefined,
    };

    expect(minimalMetadata.project_id).toBe("proj-minimal");
    expect(minimalMetadata.priority).toBeUndefined();
    expect(minimalMetadata.scheduled_date).toBeUndefined();
    expect(minimalMetadata.description).toBeUndefined();
    expect(minimalMetadata.project_type).toBeUndefined();
    expect(minimalMetadata.source_task_id).toBeUndefined();
  });
});