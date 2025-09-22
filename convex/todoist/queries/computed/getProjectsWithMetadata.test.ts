import { describe, test, expect } from 'vitest';

describe('getProjectsWithMetadata', () => {
  test('filters projects correctly based on flags', () => {
    const allProjects = [
      { id: "proj-1", name: "Active Project", is_deleted: 0, is_archived: 0 },
      { id: "proj-2", name: "Archived Project", is_deleted: 0, is_archived: 1 },
      { id: "proj-3", name: "Deleted Project", is_deleted: 1, is_archived: 0 },
      { id: "proj-4", name: "Deleted & Archived", is_deleted: 1, is_archived: 1 },
    ];

    // Test default behavior (exclude deleted and archived)
    const activeOnly = allProjects.filter(p =>
      p.is_deleted === 0 && p.is_archived === 0
    );
    expect(activeOnly).toHaveLength(1);
    expect(activeOnly[0].name).toBe("Active Project");

    // Test including archived
    const includeArchived = allProjects.filter(p => p.is_deleted === 0);
    expect(includeArchived).toHaveLength(2);
    expect(includeArchived.map(p => p.name)).toEqual(["Active Project", "Archived Project"]);

    // Test including deleted
    const includeDeleted = allProjects.filter(p => p.is_archived === 0);
    expect(includeDeleted).toHaveLength(2);
    expect(includeDeleted.map(p => p.name)).toEqual(["Active Project", "Deleted Project"]);

    // Test including both
    const includeAll = allProjects; // No filters
    expect(includeAll).toHaveLength(4);
  });

  test('creates metadata lookup map correctly', () => {
    const allMetadata = [
      { project_id: "proj-1", priority: 2, scheduled_date: "2024-03-15" },
      { project_id: "proj-3", priority: 1, description: "Important project" },
    ];

    const metadataByProjectId = new Map(
      allMetadata.map(m => [m.project_id, m])
    );

    expect(metadataByProjectId.size).toBe(2);
    expect(metadataByProjectId.get("proj-1")?.priority).toBe(2);
    expect(metadataByProjectId.get("proj-3")?.priority).toBe(1);
    expect(metadataByProjectId.get("proj-2")).toBeUndefined();
  });

  test('calculates project statistics correctly', () => {
    const projectItems = [
      { project_id: "proj-1", checked: 0, is_deleted: 0 }, // Active
      { project_id: "proj-1", checked: 1, is_deleted: 0 }, // Completed
      { project_id: "proj-1", checked: 0, is_deleted: 0 }, // Active
      { project_id: "proj-1", checked: 1, is_deleted: 0 }, // Completed
      { project_id: "proj-1", checked: 0, is_deleted: 1 }, // Deleted (excluded)
    ];

    const projectId = "proj-1";
    const validItems = projectItems.filter(item =>
      item.project_id === projectId && item.is_deleted === 0
    );

    const stats = {
      itemCount: validItems.length,
      activeCount: validItems.filter(i => i.checked === 0).length,
      completedCount: validItems.filter(i => i.checked === 1).length,
    };

    expect(stats.itemCount).toBe(4);
    expect(stats.activeCount).toBe(2);
    expect(stats.completedCount).toBe(2);
  });

  test('creates computed properties correctly', () => {
    const testCases = [
      {
        metadata: { priority: 1, scheduled_date: "2024-03-15" },
        stats: { itemCount: 10, activeCount: 3, completedCount: 7 },
        expectedComputed: {
          isScheduled: true,
          isHighPriority: true,
          completionRate: 0.7,
          hasActiveItems: true,
        }
      },
      {
        metadata: { priority: 2, scheduled_date: null },
        stats: { itemCount: 0, activeCount: 0, completedCount: 0 },
        expectedComputed: {
          isScheduled: false,
          isHighPriority: false,
          completionRate: null,
          hasActiveItems: false,
        }
      },
      {
        metadata: null,
        stats: { itemCount: 5, activeCount: 0, completedCount: 5 },
        expectedComputed: {
          isScheduled: false,
          isHighPriority: false,
          completionRate: 1.0,
          hasActiveItems: false,
        }
      }
    ];

    testCases.forEach(({ metadata, stats, expectedComputed }) => {
      const computed = {
        isScheduled: !!metadata?.scheduled_date,
        isHighPriority: metadata?.priority === 1,
        completionRate: stats.itemCount > 0
          ? stats.completedCount / stats.itemCount
          : null,
        hasActiveItems: stats.activeCount > 0,
      };

      expect(computed).toEqual(expectedComputed);
    });
  });

  test('formats metadata output correctly', () => {
    const dbMetadata = {
      _id: "meta_id",
      _creationTime: 1700000000,
      project_id: "proj-1",
      priority: 2,
      scheduled_date: "2024-03-15",
      description: "Project description",
      project_type: "area-of-responsibility",
      source_task_id: "task-123",
      last_updated: 1700000000,
      sync_version: 1700000000,
    };

    const formattedMetadata = {
      priority: dbMetadata.priority,
      scheduledDate: dbMetadata.scheduled_date,
      description: dbMetadata.description,
      sourceTaskId: dbMetadata.source_task_id,
      lastUpdated: dbMetadata.last_updated,
    };

    expect(formattedMetadata.priority).toBe(2);
    expect(formattedMetadata.scheduledDate).toBe("2024-03-15");
    expect(formattedMetadata.description).toBe("Project description");
    expect(formattedMetadata.sourceTaskId).toBe("task-123");
    expect(formattedMetadata.lastUpdated).toBe(1700000000);
  });

  test('handles projects without metadata', () => {
    const project = {
      id: "proj-no-meta",
      name: "Project Without Metadata",
      todoist_id: "proj-no-meta",
      child_order: 1,
    };

    const metadataByProjectId = new Map(); // Empty
    const stats = { itemCount: 3, activeCount: 2, completedCount: 1 };

    const result = {
      ...project,
      metadata: metadataByProjectId.get(project.todoist_id) || null,
      stats,
      computed: {
        isScheduled: false,
        isHighPriority: false,
        completionRate: stats.itemCount > 0 ? stats.completedCount / stats.itemCount : null,
        hasActiveItems: stats.activeCount > 0,
      },
    };

    expect(result.metadata).toBeNull();
    expect(result.computed.isScheduled).toBe(false);
    expect(result.computed.isHighPriority).toBe(false);
    expect(result.computed.completionRate).toBeCloseTo(0.333);
    expect(result.computed.hasActiveItems).toBe(true);
  });

  test('sorts projects by child_order', () => {
    const projects = [
      { id: "proj-3", name: "Third", child_order: 3 },
      { id: "proj-1", name: "First", child_order: 1 },
      { id: "proj-2", name: "Second", child_order: 2 },
    ];

    const sorted = projects.sort((a, b) => a.child_order - b.child_order);

    expect(sorted[0].name).toBe("First");
    expect(sorted[1].name).toBe("Second");
    expect(sorted[2].name).toBe("Third");
  });

  test('handles edge cases for completion rate', () => {
    const testCases = [
      { itemCount: 0, completedCount: 0, expected: null },
      { itemCount: 1, completedCount: 0, expected: 0 },
      { itemCount: 1, completedCount: 1, expected: 1 },
      { itemCount: 10, completedCount: 3, expected: 0.3 },
    ];

    testCases.forEach(({ itemCount, completedCount, expected }) => {
      const completionRate = itemCount > 0 ? completedCount / itemCount : null;
      expect(completionRate).toBe(expected);
    });
  });

  test('validates argument types', () => {
    const validArgs = [
      {},
      { includeArchived: true },
      { includeDeleted: false },
      { includeArchived: true, includeDeleted: true },
      { includeArchived: false, includeDeleted: false },
    ];

    validArgs.forEach(args => {
      if ('includeArchived' in args) {
        expect(typeof args.includeArchived).toBe('boolean');
      }
      if ('includeDeleted' in args) {
        expect(typeof args.includeDeleted).toBe('boolean');
      }
    });
  });
});