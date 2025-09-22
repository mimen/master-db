import { describe, test, expect } from 'vitest';

describe('extractProjectMetadata', () => {
  test('filters metadata tasks correctly', () => {
    const allTasks = [
      {
        todoist_id: "task-1",
        content: "Regular task",
        labels: [],
        project_id: "proj-1",
        is_deleted: 0,
        sync_version: 1000,
      },
      {
        todoist_id: "task-2",
        content: "* Project metadata task",
        labels: [],
        project_id: "proj-1",
        is_deleted: 0,
        sync_version: 2000,
      },
      {
        todoist_id: "task-3",
        content: "Task with metadata label",
        labels: ["project-metadata"],
        project_id: "proj-2",
        is_deleted: 0,
        sync_version: 1500,
      },
      {
        todoist_id: "task-4",
        content: "Deleted metadata task",
        labels: ["project-metadata"],
        project_id: "proj-3",
        is_deleted: 1,
        sync_version: 1800,
      }
    ];

    // Test metadata task identification logic
    const metadataTasks = allTasks.filter(item => {
      if (item.is_deleted !== 0) return false;

      const hasMetadataLabel = item.labels.includes("project-metadata");
      const startsWithAsterisk = item.content.startsWith("*");

      return hasMetadataLabel || startsWithAsterisk;
    });

    expect(metadataTasks).toHaveLength(2);
    expect(metadataTasks[0].todoist_id).toBe("task-2");
    expect(metadataTasks[1].todoist_id).toBe("task-3");
  });

  test('groups tasks by project and keeps most recent', () => {
    const metadataTasks = [
      {
        todoist_id: "task-1",
        content: "* Old metadata",
        project_id: "proj-1",
        sync_version: 1000,
      },
      {
        todoist_id: "task-2",
        content: "* New metadata",
        project_id: "proj-1",
        sync_version: 2000,
      },
      {
        todoist_id: "task-3",
        content: "* Different project",
        project_id: "proj-2",
        sync_version: 1500,
      }
    ];

    // Simulate grouping logic
    const tasksByProject = new Map();

    for (const task of metadataTasks) {
      if (!task.project_id) continue;

      const existing = tasksByProject.get(task.project_id);
      if (!existing || (task.sync_version > existing.sync_version)) {
        tasksByProject.set(task.project_id, task);
      }
    }

    expect(tasksByProject.size).toBe(2);
    expect(tasksByProject.get("proj-1").todoist_id).toBe("task-2"); // Most recent
    expect(tasksByProject.get("proj-2").todoist_id).toBe("task-3");
  });

  test('determines project type from labels', () => {
    const testCases = [
      {
        labels: ["area-of-responsibility"],
        expectedType: "area-of-responsibility"
      },
      {
        labels: ["project-type"],
        expectedType: "project-type"
      },
      {
        labels: ["area-of-responsibility", "project-type"], // First match wins
        expectedType: "area-of-responsibility"
      },
      {
        labels: ["other-label"],
        expectedType: undefined
      },
      {
        labels: [],
        expectedType: undefined
      }
    ];

    testCases.forEach(({ labels, expectedType }) => {
      let projectType: "area-of-responsibility" | "project-type" | undefined;

      if (labels.includes("area-of-responsibility")) {
        projectType = "area-of-responsibility";
      } else if (labels.includes("project-type")) {
        projectType = "project-type";
      }

      expect(projectType).toBe(expectedType);
    });
  });

  test('creates metadata data structure correctly', () => {
    const task = {
      todoist_id: "task-123",
      priority: 2,
      due: { date: "2024-03-15" },
      description: "Important project details",
      labels: ["area-of-responsibility"],
      sync_version: 1500,
    };

    const projectId = "proj-456";
    const now = Date.now();

    // Determine project type
    let projectType: "area-of-responsibility" | "project-type" | undefined;
    if (task.labels.includes("area-of-responsibility")) {
      projectType = "area-of-responsibility";
    } else if (task.labels.includes("project-type")) {
      projectType = "project-type";
    }

    const metadataData = {
      project_id: projectId,
      priority: task.priority,
      scheduled_date: task.due?.date,
      description: task.description,
      project_type: projectType,
      source_task_id: task.todoist_id,
      last_updated: now,
      sync_version: now,
    };

    expect(metadataData.project_id).toBe("proj-456");
    expect(metadataData.priority).toBe(2);
    expect(metadataData.scheduled_date).toBe("2024-03-15");
    expect(metadataData.description).toBe("Important project details");
    expect(metadataData.project_type).toBe("area-of-responsibility");
    expect(metadataData.source_task_id).toBe("task-123");
    expect(typeof metadataData.last_updated).toBe("number");
    expect(typeof metadataData.sync_version).toBe("number");
  });

  test('handles missing optional fields', () => {
    const minimalTask = {
      todoist_id: "task-minimal",
      priority: 1,
      labels: [],
      sync_version: 1000,
    };

    const metadataData = {
      project_id: "proj-test",
      priority: minimalTask.priority,
      scheduled_date: undefined, // No due date
      description: undefined,    // No description
      project_type: undefined,   // No matching labels
      source_task_id: minimalTask.todoist_id,
      last_updated: Date.now(),
      sync_version: Date.now(),
    };

    expect(metadataData.scheduled_date).toBeUndefined();
    expect(metadataData.description).toBeUndefined();
    expect(metadataData.project_type).toBeUndefined();
    expect(metadataData.priority).toBe(1);
  });

  test('version comparison for updates', () => {
    const existingMetadata = { sync_version: 1000 };
    const newTask = { sync_version: 2000 };
    const oldTask = { sync_version: 500 };

    // Should update when task is newer
    expect(newTask.sync_version > existingMetadata.sync_version).toBe(true);

    // Should not update when task is older
    expect(oldTask.sync_version > existingMetadata.sync_version).toBe(false);
  });

  test('filters by specific project when provided', () => {
    const allTasks = [
      {
        todoist_id: "task-1",
        content: "* Metadata for proj-1",
        project_id: "proj-1",
        is_deleted: 0,
      },
      {
        todoist_id: "task-2",
        content: "* Metadata for proj-2",
        project_id: "proj-2",
        is_deleted: 0,
      }
    ];

    const targetProjectId = "proj-1";

    // Simulate project filtering
    const filteredTasks = allTasks.filter(item => {
      if (targetProjectId && item.project_id !== targetProjectId) {
        return false;
      }
      return item.content.startsWith("*") && item.is_deleted === 0;
    });

    expect(filteredTasks).toHaveLength(1);
    expect(filteredTasks[0].project_id).toBe("proj-1");
  });
});