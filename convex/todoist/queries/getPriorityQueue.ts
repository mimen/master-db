import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { Doc } from "../../_generated/dataModel";
import { query } from "../../_generated/server";
import { processQueue } from "../helpers/queueEngine";

export const getPriorityQueue = query({
  args: {
    include_assigned_to_others: v.optional(v.boolean()),
    max_tasks: v.optional(v.number()),
    target_hours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxTasks = args.max_tasks || 7;
    const includeAssignedToOthers = args.include_assigned_to_others || false;

    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;

    const allItems: Doc<"todoist_items">[] = await ctx.runQuery(
      internal.todoist.internalQueries.getFilteredActiveItems.getFilteredActiveItems,
      {
        assigneeFilter: includeAssignedToOthers ? 'all' : 'not-assigned-to-others',
        currentUserId: userId,
      }
    );

    const projectMetadata = await ctx.db
      .query("todoist_project_metadata")
      .collect();

    const projectMetadataMap = new Map();
    for (const metadata of projectMetadata) {
      projectMetadataMap.set(metadata.project_id, metadata);
    }

    // Priority queue configuration - focus on urgent and important
    const _queueConfig = {
      filters: [
        {
          type: "custom" as const,
          condition: "overdue",
          mode: "include" as const,
        },
        {
          type: "priority" as const,
          minPriority: 2, // P1 and P2 only
          mode: "include" as const,
        },
        {
          type: "date" as const,
          range: "today" as const,
          mode: "include" as const,
        },
        {
          type: "date" as const,
          range: "tomorrow" as const,
          mode: "include" as const,
        },
      ],
      ordering: [
        { field: "priority", direction: "desc" as const },
        { field: "dueDate", direction: "asc" as const, nullsFirst: false },
        { field: "childOrder", direction: "asc" as const },
      ],
      maxTasks,
    };

    // Get all projects for name lookup first
    const allProjects = await ctx.db
      .query("todoist_projects")
      .filter((q) => q.eq(q.field("is_deleted"), false))
      .collect();

    const projectMap = new Map();
    for (const project of allProjects) {
      projectMap.set(project.todoist_id, project);
    }

    // Get P1 projects (priority 4) to create individual segments for each
    const p1Projects = projectMetadata.filter(meta => meta.priority === 4);
    const p2Projects = projectMetadata.filter(meta => meta.priority === 3);

    // Build dynamic segments - each P1 project gets its own segment
    const segments = [];

    // First: Individual segment for each P1 project
    for (const p1Project of p1Projects) {
      const project = projectMap.get(p1Project.project_id);
      const projectName = project?.name || "Unknown Project";

      segments.push({
        name: projectName,
        filters: [
          { type: "project" as const, projectIds: [p1Project.project_id] },
        ],
        ordering: [
          { field: "priority", direction: "desc" as const },
          { field: "dueDate", direction: "asc" as const, nullsFirst: false },
          { field: "childOrder", direction: "asc" as const },
        ],
        maxTasks: Math.max(3, Math.ceil(maxTasks * 0.60 / p1Projects.length)), // Distribute 60% among P1 projects
      });
    }

    // Second: P2 projects combined
    if (p2Projects.length > 0) {
      segments.push({
        name: "P2 Projects",
        filters: [
          { type: "projectPriority" as const, priorities: [3] }, // P2 projects only
        ],
        ordering: [
          { field: "priority", direction: "desc" as const },
          { field: "dueDate", direction: "asc" as const, nullsFirst: false },
          { field: "childOrder", direction: "asc" as const },
        ],
        maxTasks: Math.ceil(maxTasks * 0.25), // Reserve 25% for P2 projects
      });
    }

    // Third: High priority tasks from any project (fallback)
    segments.push({
      name: "Other High Priority",
      filters: [
        { type: "priority" as const, minPriority: 3 }, // P1, P2, P3 task priority
      ],
      ordering: [
        { field: "priority", direction: "desc" as const },
        { field: "projectPriority", direction: "desc" as const },
        { field: "dueDate", direction: "asc" as const, nullsFirst: false },
      ],
      maxTasks: Math.ceil(maxTasks * 0.15), // Reserve 15% for other high priority tasks
    });

    interface QueueItem {
      task: typeof allItems[0];
      segment: string;
      projectName?: string;
    }

    const priorityItems: QueueItem[] = [];
    const seenIds = new Set<string>();

    // Process each segment until we have enough tasks
    for (const segmentConfig of segments) {
      if (priorityItems.length >= maxTasks) break;

      const segmentItems = processQueue(allItems, segmentConfig, userId, projectMetadataMap);

      // Add unique items from this segment with grouping info
      for (const item of segmentItems) {
        if (!seenIds.has(item.todoist_id) && priorityItems.length < maxTasks) {
          const project = projectMap.get(item.project_id);
          priorityItems.push({
            task: item,
            segment: segmentConfig.name || "Unknown",
            projectName: project?.name || "Unknown Project",
          });
          seenIds.add(item.todoist_id);
        }
      }
    }

    // If we still need more items, add other high-priority items with project priority consideration
    if (priorityItems.length < maxTasks) {
      const fillConfig = {
        name: "Fill - High Priority",
        filters: [
          { type: "priority" as const, minPriority: 2 }, // P1, P2 and above
        ],
        ordering: [
          { field: "projectPriority", direction: "desc" as const },
          { field: "priority", direction: "desc" as const },
          { field: "dueDate", direction: "asc" as const, nullsFirst: false },
        ],
        maxTasks: maxTasks - priorityItems.length,
      };

      const fillItems = processQueue(allItems, fillConfig, userId, projectMetadataMap)
        .filter(item => !seenIds.has(item.todoist_id));

      // Add fill items with grouping info
      for (const item of fillItems) {
        if (priorityItems.length >= maxTasks) break;
        const project = projectMap.get(item.project_id);
        priorityItems.push({
          task: item,
          segment: "Fill - High Priority",
          projectName: project?.name || "Unknown Project",
        });
      }
    }

    const result = priorityItems.map(item => ({
      ...item.task,
      _queueSegment: item.segment,
      _projectName: item.projectName,
    }));

    return result;
  },
});