import { Doc } from "../../_generated/dataModel";

// Constants for system-wide exclusions
export const SYSTEM_EXCLUDED_LABELS = [
  'area-of-responsibility',
  'project-type',
  'project-metadata'
] as const;

// Filter configuration types
export interface GlobalFilterConfig {
  assigneeFilter?: AssigneeFilterType;
  currentUserId?: string;
  includeCompleted?: boolean; // Default: false
  includeStarPrefix?: boolean; // Default: false
}

export type AssigneeFilterType =
  | 'all'
  | 'unassigned'
  | 'assigned-to-me'
  | 'assigned-to-others'
  | 'not-assigned-to-others'; // Default

/**
 * Apply global filters to Todoist items.
 * This includes filtering out system labels, star prefix tasks, completed items, and assignee filtering.
 */
export function applyGlobalFilters(
  items: Doc<"todoist_items">[],
  config: GlobalFilterConfig = {}
): Doc<"todoist_items">[] {
  const {
    assigneeFilter = 'not-assigned-to-others',
    currentUserId,
    includeCompleted = false,
    includeStarPrefix = false,
  } = config;

  return items.filter(item => {
    // 1. Star prefix filter (e.g., "* Project metadata")
    if (!includeStarPrefix && item.content.startsWith('* ')) {
      return false;
    }

    // 2. Completed items filter
    if (!includeCompleted && item.checked === true) {
      return false;
    }

    // 3. System excluded labels filter
    if (item.labels.some(label => SYSTEM_EXCLUDED_LABELS.includes(label as typeof SYSTEM_EXCLUDED_LABELS[number]))) {
      return false;
    }

    // 4. Assignee filter
    if (assigneeFilter !== 'all') {
      switch (assigneeFilter) {
        case 'unassigned':
          return !item.assignee_id;

        case 'assigned-to-me':
          return item.assignee_id === currentUserId;

        case 'assigned-to-others':
          return item.assignee_id && item.assignee_id !== currentUserId;

        case 'not-assigned-to-others':
          return !item.assignee_id || item.assignee_id === currentUserId;
      }
    }

    return true;
  });
}

/**
 * Filter builder for more complex filtering scenarios.
 * Allows chaining multiple filter conditions.
 */
export class TodoistFilterBuilder {
  private filters: ((item: Doc<"todoist_items">) => boolean)[] = [];

  excludeLabels(labels: string[]): this {
    this.filters.push(item =>
      !item.labels.some(label => labels.includes(label))
    );
    return this;
  }

  excludeStarPrefix(): this {
    this.filters.push(item => !item.content.startsWith('* '));
    return this;
  }

  excludeCompleted(): this {
    this.filters.push(item => item.checked === false);
    return this;
  }

  filterByAssignee(type: AssigneeFilterType, userId?: string): this {
    this.filters.push(item => {
      switch (type) {
        case 'all':
          return true;
        case 'unassigned':
          return !item.assignee_id;
        case 'assigned-to-me':
          return item.assignee_id === userId;
        case 'assigned-to-others':
          return !!item.assignee_id && item.assignee_id !== userId;
        case 'not-assigned-to-others':
          return !item.assignee_id || item.assignee_id === userId;
        default:
          return true;
      }
    });
    return this;
  }

  build(): (item: Doc<"todoist_items">) => boolean {
    return (item) => this.filters.every(filter => filter(item));
  }
}