import { Doc } from "../../_generated/dataModel";

/**
 * Helper functions for computed properties
 */

export type ProjectWithStats = Doc<"todoist_projects"> & {
  stats: {
    itemCount: number;
    activeCount: number;
    completedCount: number;
  };
};

export type ProjectWithMetadata = ProjectWithStats & {
  metadata: {
    priority?: number;
    scheduledDate?: string;
    description?: string;
    sourceTaskId?: string;
    lastUpdated?: number;
  } | null;
  computed: {
    isScheduled: boolean;
    isHighPriority: boolean;
    completionRate: number | null;
    hasActiveItems: boolean;
  };
};

/**
 * Calculate item statistics for a project
 */
export function calculateProjectStats(
  items: Doc<"todoist_items">[],
  projectId: string
): ProjectWithStats["stats"] {
  const projectItems = items.filter(item => item.project_id === projectId);
  
  return {
    itemCount: projectItems.length,
    activeCount: projectItems.filter(i => i.checked === 0).length,
    completedCount: projectItems.filter(i => i.checked === 1).length,
  };
}

/**
 * Calculate computed properties for a project with metadata
 */
export function calculateComputedProperties(
  metadata: Doc<"todoist_project_metadata"> | null,
  stats: ProjectWithStats["stats"]
): ProjectWithMetadata["computed"] {
  return {
    isScheduled: !!metadata?.scheduled_date,
    isHighPriority: metadata?.priority === 1,
    completionRate: stats.itemCount > 0 
      ? stats.completedCount / stats.itemCount 
      : null,
    hasActiveItems: stats.activeCount > 0,
  };
}

/**
 * Check if a task is a metadata task
 */
export function isMetadataTask(task: Doc<"todoist_items">): boolean {
  return task.labels.includes("project-metadata") || task.content.startsWith("*");
}

/**
 * Extract metadata from a task
 */
export function extractMetadataFromTask(task: Doc<"todoist_items">) {
  if (!isMetadataTask(task)) {
    return null;
  }
  
  return {
    priority: task.priority,
    scheduledDate: task.due?.date,
    description: task.description,
    sourceTaskId: task.todoist_id,
  };
}

/**
 * Sort projects by various criteria
 */
export const projectSorters = {
  byChildOrder: (a: Doc<"todoist_projects">, b: Doc<"todoist_projects">) => 
    a.child_order - b.child_order,
    
  byName: (a: Doc<"todoist_projects">, b: Doc<"todoist_projects">) => 
    a.name.localeCompare(b.name),
    
  byActiveItemCount: (a: ProjectWithStats, b: ProjectWithStats) => 
    b.stats.activeCount - a.stats.activeCount,
    
  byCompletionRate: (a: ProjectWithMetadata, b: ProjectWithMetadata) => {
    const rateA = a.computed.completionRate ?? -1;
    const rateB = b.computed.completionRate ?? -1;
    return rateB - rateA;
  },
  
  byScheduledDate: (a: ProjectWithMetadata, b: ProjectWithMetadata) => {
    if (!a.metadata?.scheduledDate && !b.metadata?.scheduledDate) return 0;
    if (!a.metadata?.scheduledDate) return 1;
    if (!b.metadata?.scheduledDate) return -1;
    
    return new Date(a.metadata.scheduledDate).getTime() - 
           new Date(b.metadata.scheduledDate).getTime();
  },
};