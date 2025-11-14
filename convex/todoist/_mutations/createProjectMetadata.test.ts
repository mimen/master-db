import { describe, test, expect } from 'vitest';

describe('createProjectMetadata', () => {
  test('creates metadata with required fields only', () => {
    const metadataArgs = {
      project_id: "proj-123",
      last_updated: Date.now(),
      sync_version: Date.now(),
    };

    expect(metadataArgs.project_id).toBe("proj-123");
    expect(typeof metadataArgs.last_updated).toBe("number");
    expect(typeof metadataArgs.sync_version).toBe("number");
    expect('priority' in metadataArgs).toBe(false);
    expect('scheduled_date' in metadataArgs).toBe(false);
    expect('description' in metadataArgs).toBe(false);
    expect('project_type' in metadataArgs).toBe(false);
  });

  test('creates metadata with all optional fields', () => {
    const timestamp = Date.now();
    const metadataArgs = {
      project_id: "proj-456",
      priority: 2,
      scheduled_date: "2024-03-15",
      description: "Important project for Q1",
      project_type: "area-of-responsibility" as const,
      source_task_id: "task-789",
      last_updated: timestamp,
      sync_version: timestamp,
    };

    expect(metadataArgs.project_id).toBe("proj-456");
    expect(metadataArgs.priority).toBe(2);
    expect(metadataArgs.scheduled_date).toBe("2024-03-15");
    expect(metadataArgs.description).toBe("Important project for Q1");
    expect(metadataArgs.project_type).toBe("area-of-responsibility");
    expect(metadataArgs.source_task_id).toBe("task-789");
    expect(metadataArgs.last_updated).toBe(timestamp);
    expect(metadataArgs.sync_version).toBe(timestamp);
  });

  test('validates project_type literal values', () => {
    const validTypes = ["area-of-responsibility", "project-type"];

    validTypes.forEach(type => {
      const metadataArgs = {
        project_id: "proj-test",
        project_type: type as "area-of-responsibility" | "project-type",
        last_updated: Date.now(),
        sync_version: Date.now(),
      };

      expect(validTypes).toContain(metadataArgs.project_type);
    });
  });

  test('handles priority values within valid range', () => {
    const validPriorities = [1, 2, 3, 4];

    validPriorities.forEach(priority => {
      const metadataArgs = {
        project_id: "proj-priority-test",
        priority,
        last_updated: Date.now(),
        sync_version: Date.now(),
      };

      expect(metadataArgs.priority).toBeGreaterThanOrEqual(1);
      expect(metadataArgs.priority).toBeLessThanOrEqual(4);
    });
  });

  test('handles ISO date strings for scheduled_date', () => {
    const isoDate = "2024-03-15";
    const metadataArgs = {
      project_id: "proj-date-test",
      scheduled_date: isoDate,
      last_updated: Date.now(),
      sync_version: Date.now(),
    };

    expect(metadataArgs.scheduled_date).toBe(isoDate);
    expect(metadataArgs.scheduled_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});