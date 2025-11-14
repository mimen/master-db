import { Doc } from "../../_generated/dataModel";

// Type definitions for queue processing
export type QueueFilter =
  | ProjectFilter
  | PriorityFilter
  | LabelFilter
  | DateFilter
  | CustomFilter
  | AssigneeFilter
  | ProjectPriorityFilter;

export interface ProjectFilter {
  type: "project";
  mode?: "include" | "exclude";
  projectIds: string[];
  includeSubprojects?: boolean;
}

export interface PriorityFilter {
  type: "priority";
  mode?: "include" | "exclude";
  priorities?: number[];
  minPriority?: number;
}

export interface LabelFilter {
  type: "label";
  mode?: "include" | "exclude";
  labels: string[];
}

export interface DateFilter {
  type: "date";
  mode?: "include" | "exclude";
  range: string;
  includeDeadlines?: boolean;
  combineDueAndDeadline?: boolean;
}

export interface CustomFilter {
  type: "custom";
  mode?: "include" | "exclude";
  condition: string;
}

export interface AssigneeFilter {
  type: "assignee";
  mode?: "include" | "exclude";
  filter: string;
}

export interface ProjectPriorityFilter {
  type: "projectPriority";
  mode?: "include" | "exclude";
  priorities?: number[];
  minPriority?: number;
}

export interface OrderingRule {
  field: string;
  direction: "asc" | "desc";
  nullsFirst?: boolean;
}

export interface QueueConfig {
  filters: QueueFilter[];
  ordering: OrderingRule[];
  maxTasks?: number;
}

// Date helper functions
const getDateComparisons = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString().split('T')[0];

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowISO = tomorrow.toISOString().split('T')[0];

  const next7Days = new Date(today);
  next7Days.setDate(next7Days.getDate() + 7);
  const next7DaysISO = next7Days.toISOString().split('T')[0];

  return { today, todayISO, tomorrowISO, next7DaysISO };
};

// Filter implementation functions
const applyProjectFilter = (items: Doc<"todoist_items">[], filter: ProjectFilter): Doc<"todoist_items">[] => {
  const { projectIds, includeSubprojects: _includeSubprojects = false, mode = "include" } = filter;

  const matchesFilter = (item: Doc<"todoist_items">) => {
    if (!item.project_id) return false;

    // Simple project matching for now
    // TODO: Add subproject support when project hierarchy is available
    return projectIds.includes(item.project_id);
  };

  return mode === "include"
    ? items.filter(matchesFilter)
    : items.filter(item => !matchesFilter(item));
};

const applyPriorityFilter = (items: Doc<"todoist_items">[], filter: PriorityFilter): Doc<"todoist_items">[] => {
  const { priorities, minPriority, mode = "include" } = filter;

  const matchesFilter = (item: Doc<"todoist_items">) => {
    if (priorities && priorities.length > 0) {
      return priorities.includes(item.priority);
    }
    if (minPriority !== undefined && minPriority !== null) {
      return item.priority >= minPriority;
    }
    return true;
  };

  return mode === "include"
    ? items.filter(matchesFilter)
    : items.filter(item => !matchesFilter(item));
};

const applyLabelFilter = (items: Doc<"todoist_items">[], filter: LabelFilter): Doc<"todoist_items">[] => {
  const { labels, mode = "include" } = filter;

  const matchesFilter = (item: Doc<"todoist_items">) => {
    if (!labels || labels.length === 0) return true;
    return labels.some((label: string) => item.labels.includes(label));
  };

  return mode === "include"
    ? items.filter(matchesFilter)
    : items.filter(item => !matchesFilter(item));
};

const applyDateFilter = (items: Doc<"todoist_items">[], filter: DateFilter): Doc<"todoist_items">[] => {
  const { range, includeDeadlines = false, combineDueAndDeadline = false, mode = "include" } = filter;
  const { todayISO, tomorrowISO, next7DaysISO } = getDateComparisons();

  const matchesDateRange = (dateStr: string | undefined): boolean => {
    if (!dateStr) return range === "none";

    const dateOnly = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;

    switch (range) {
      case "overdue": return dateOnly < todayISO;
      case "today": return dateOnly === todayISO;
      case "tomorrow": return dateOnly === tomorrowISO;
      case "next7days": return dateOnly > tomorrowISO && dateOnly <= next7DaysISO;
      case "future": return dateOnly > next7DaysISO;
      case "none": return false;
      default: return true;
    }
  };

  const matchesFilter = (item: Doc<"todoist_items">) => {
    const dueDate = item.due?.date;
    const deadlineDate = item.deadline?.date;

    if (range === "none") {
      if (combineDueAndDeadline) {
        return !dueDate && !deadlineDate;
      } else if (includeDeadlines) {
        return !deadlineDate;
      } else {
        return !dueDate;
      }
    }

    if (combineDueAndDeadline) {
      return matchesDateRange(dueDate) || matchesDateRange(deadlineDate);
    } else if (includeDeadlines) {
      return matchesDateRange(deadlineDate);
    } else {
      return matchesDateRange(dueDate);
    }
  };

  return mode === "include"
    ? items.filter(matchesFilter)
    : items.filter(item => !matchesFilter(item));
};

const applyCustomFilter = (items: Doc<"todoist_items">[], filter: CustomFilter): Doc<"todoist_items">[] => {
  const { condition, mode = "include" } = filter;
  const { todayISO } = getDateComparisons();

  const matchesFilter = (item: Doc<"todoist_items">) => {
    switch (condition) {
      case "overdue": {
        const dueDate = item.due?.date;
        return dueDate ? dueDate.split('T')[0] < todayISO : false;
      }
      case "no-date":
        return !item.due?.date && !item.deadline?.date;
      case "has-subtasks":
        // TODO: Implement when parent-child relationships are available
        return false;
      case "no-subtasks":
        return !item.parent_id;
      case "recurring":
        return item.due?.is_recurring === true;
      case "non-recurring":
        return !item.due?.is_recurring;
      default:
        return true;
    }
  };

  return mode === "include"
    ? items.filter(matchesFilter)
    : items.filter(item => !matchesFilter(item));
};

const applyAssigneeFilter = (items: Doc<"todoist_items">[], filter: AssigneeFilter, currentUserId?: string): Doc<"todoist_items">[] => {
  const { filter: assigneeFilter, mode = "include" } = filter;

  const matchesFilter = (item: Doc<"todoist_items">) => {
    switch (assigneeFilter) {
      case "all":
        return true;
      case "unassigned":
        return !item.assignee_id;
      case "assigned-to-me":
        return item.assignee_id === currentUserId;
      case "assigned-to-others":
        return item.assignee_id && item.assignee_id !== currentUserId;
      case "not-assigned-to-others":
        return !item.assignee_id || item.assignee_id === currentUserId;
      default:
        return true;
    }
  };

  return mode === "include"
    ? items.filter(matchesFilter)
    : items.filter(item => !matchesFilter(item));
};

const applyProjectPriorityFilter = (items: Doc<"todoist_items">[], filter: ProjectPriorityFilter, projectMetadata?: Map<string, Doc<"todoist_project_metadata">>): Doc<"todoist_items">[] => {
  const { priorities, minPriority, mode = "include" } = filter;

  const matchesFilter = (item: Doc<"todoist_items">) => {
    const metadata = projectMetadata?.get(item.project_id || "");
    const projectPriority = metadata?.priority || 0;

    if (priorities && priorities.length > 0) {
      return priorities.includes(projectPriority);
    }
    if (minPriority !== undefined && minPriority !== null) {
      return projectPriority >= minPriority;
    }
    return true;
  };

  return mode === "include"
    ? items.filter(matchesFilter)
    : items.filter(item => !matchesFilter(item));
};

// Main filter application function
export const applyQueueFilters = (
  items: Doc<"todoist_items">[],
  filters: QueueFilter[],
  currentUserId?: string,
  projectMetadata?: Map<string, Doc<"todoist_project_metadata">>
): Doc<"todoist_items">[] => {
  let filteredItems = items;

  for (const filter of filters) {
    switch (filter.type) {
      case "project":
        filteredItems = applyProjectFilter(filteredItems, filter);
        break;
      case "priority":
        filteredItems = applyPriorityFilter(filteredItems, filter);
        break;
      case "label":
        filteredItems = applyLabelFilter(filteredItems, filter);
        break;
      case "date":
        filteredItems = applyDateFilter(filteredItems, filter);
        break;
      case "custom":
        filteredItems = applyCustomFilter(filteredItems, filter);
        break;
      case "assignee":
        filteredItems = applyAssigneeFilter(filteredItems, filter, currentUserId);
        break;
      case "projectPriority":
        filteredItems = applyProjectPriorityFilter(filteredItems, filter, projectMetadata);
        break;
    }
  }

  return filteredItems;
};

// Sort value extraction functions
const getSortValue = (item: Doc<"todoist_items">, field: string, projectMetadata?: Map<string, Doc<"todoist_project_metadata">>): string | number | boolean | null | undefined => {
  switch (field) {
    case "priority":
      return item.priority;
    case "dueDate":
      return item.due?.date || null;
    case "deadline":
      return item.deadline?.date || null;
    case "createdDate":
      return item.added_at;
    case "childOrder":
      return item.child_order;
    case "content":
      return item.content.toLowerCase();
    case "projectPriority":
      // TODO: Get from project metadata when available
      return projectMetadata?.get(item.project_id || "")?.priority || 0;
    case "labelPriority":
      // TODO: Calculate max priority from labels when label priorities are available
      return 0;
    default:
      return null;
  }
};

// Main ordering function
export const applyQueueOrdering = (
  items: Doc<"todoist_items">[],
  ordering: OrderingRule[],
  projectMetadata?: Map<string, Doc<"todoist_project_metadata">>
): Doc<"todoist_items">[] => {
  if (ordering.length === 0) {
    return items.sort((a, b) => a.child_order - b.child_order);
  }

  return items.sort((a, b) => {
    for (const rule of ordering) {
      const aValue = getSortValue(a, rule.field, projectMetadata);
      const bValue = getSortValue(b, rule.field, projectMetadata);

      // Handle null values
      if (aValue === null && bValue === null) continue;
      if (aValue === null) return rule.nullsFirst ? -1 : 1;
      if (bValue === null) return rule.nullsFirst ? 1 : -1;

      // Compare values
      let comparison = 0;
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        comparison = aValue.localeCompare(bValue);
      } else if (typeof aValue === 'number' && typeof bValue === 'number') {
        comparison = aValue - bValue;
      } else {
        comparison = String(aValue).localeCompare(String(bValue));
      }

      if (comparison !== 0) {
        return rule.direction === "desc" ? -comparison : comparison;
      }
    }

    // Fallback to child_order if all sort fields are equal
    return a.child_order - b.child_order;
  });
};

// Main queue processing function
export const processQueue = (
  items: Doc<"todoist_items">[],
  config: QueueConfig,
  currentUserId?: string,
  projectMetadata?: Map<string, Doc<"todoist_project_metadata">>
): Doc<"todoist_items">[] => {
  // Apply filters
  let processedItems = applyQueueFilters(items, config.filters, currentUserId, projectMetadata);

  // Apply ordering
  processedItems = applyQueueOrdering(processedItems, config.ordering, projectMetadata);

  // Apply limit
  if (config.maxTasks && config.maxTasks > 0) {
    processedItems = processedItems.slice(0, config.maxTasks);
  }

  return processedItems;
};