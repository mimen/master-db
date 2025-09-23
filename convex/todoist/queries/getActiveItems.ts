import { v } from "convex/values";

import { Doc } from "../../_generated/dataModel";
import { query } from "../../_generated/server";
import { applyGlobalFilters } from "../helpers/globalFilters";

// Date comparison helper functions
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

// Check if a date string matches the time filter
const matchesTimeFilter = (
  dateStr: string | undefined,
  timeFilter: string,
  { todayISO, tomorrowISO, next7DaysISO }: ReturnType<typeof getDateComparisons>
): boolean => {
  if (!dateStr) return timeFilter === 'none';

  // Handle datetime strings by extracting date part
  const dateOnly = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;

  switch (timeFilter) {
    case 'overdue':
      return dateOnly < todayISO;
    case 'today':
      return dateOnly === todayISO;
    case 'tomorrow':
      return dateOnly === tomorrowISO;
    case 'next7days':
      return dateOnly > tomorrowISO && dateOnly <= next7DaysISO;
    case 'future':
      return dateOnly > next7DaysISO;
    case 'none':
      return false; // Already handled above
    case 'all':
      return true;
    default:
      return true;
  }
};

// Check if an item matches the time filter considering both due date and deadline
const itemMatchesTimeFilter = (
  item: Doc<"todoist_items">,
  timeFilter: string | undefined,
  includeDeadlines: boolean = false,
  combineDueAndDeadline: boolean = false,
  dateComparisons: ReturnType<typeof getDateComparisons>
): boolean => {
  if (!timeFilter || timeFilter === 'all') return true;

  const dueDate = item.due?.date;
  const deadlineDate = item.deadline?.date;

  if (timeFilter === 'none') {
    if (combineDueAndDeadline) {
      return !dueDate && !deadlineDate;
    } else if (includeDeadlines) {
      return !deadlineDate;
    } else {
      return !dueDate;
    }
  }

  if (combineDueAndDeadline) {
    // Match if either due date OR deadline matches the filter
    return matchesTimeFilter(dueDate, timeFilter, dateComparisons) ||
           matchesTimeFilter(deadlineDate, timeFilter, dateComparisons);
  } else if (includeDeadlines) {
    // Only check deadline
    return matchesTimeFilter(deadlineDate, timeFilter, dateComparisons);
  } else {
    // Only check due date (default behavior)
    return matchesTimeFilter(dueDate, timeFilter, dateComparisons);
  }
};

/**
 * Get active Todoist items with global filters applied.
 * Filters out: star prefix tasks, system labels, completed tasks, and applies assignee filtering.
 */
export const getActiveItems = query({
  args: {
    projectId: v.optional(v.string()),
    limit: v.optional(v.number()),
    // UI can override assignee filter
    assigneeFilter: v.optional(
      v.union(
        v.literal('all'),
        v.literal('unassigned'),
        v.literal('assigned-to-me'),
        v.literal('assigned-to-others'),
        v.literal('not-assigned-to-others')
      )
    ),
    // Time filtering options
    timeFilter: v.optional(v.union(
      v.literal('overdue'),
      v.literal('today'),
      v.literal('tomorrow'),
      v.literal('next7days'),
      v.literal('future'),
      v.literal('none'),
      v.literal('all')
    )),
    includeDeadlines: v.optional(v.boolean()), // Default false for backward compatibility
    combineDueAndDeadline: v.optional(v.boolean()), // Default false
  },
  handler: async (ctx, args) => {
    // Get raw data directly (internal query logic embedded for now)
    let q = ctx.db
      .query("todoist_items")
      .filter((q) => q.eq(q.field("checked"), false))
      .filter((q) => q.eq(q.field("is_deleted"), false));

    if (args.projectId) {
      q = q.filter((q) => q.eq(q.field("project_id"), args.projectId));
    }

    const items = await q.collect();

    // Apply time filtering if specified
    let filteredItems = items;
    if (args.timeFilter) {
      const dateComparisons = getDateComparisons();
      filteredItems = items.filter(item =>
        itemMatchesTimeFilter(
          item,
          args.timeFilter,
          args.includeDeadlines || false,
          args.combineDueAndDeadline || false,
          dateComparisons
        )
      );
    }

    // Sort by child_order, but prioritize by time if time filter is active
    let sortedItems: typeof filteredItems;
    if (args.timeFilter && args.timeFilter !== 'all' && args.timeFilter !== 'none') {
      // Sort by due date/deadline first, then by child_order
      sortedItems = filteredItems.sort((a, b) => {
        const getRelevantDate = (item: Doc<"todoist_items">) => {
          if (args.combineDueAndDeadline) {
            // Use earliest of due date or deadline
            const dueDate = item.due?.date;
            const deadlineDate = item.deadline?.date;
            if (dueDate && deadlineDate) {
              return dueDate < deadlineDate ? dueDate : deadlineDate;
            }
            return dueDate || deadlineDate;
          } else if (args.includeDeadlines) {
            return item.deadline?.date;
          } else {
            return item.due?.date;
          }
        };

        const aDate = getRelevantDate(a);
        const bDate = getRelevantDate(b);

        if (aDate && bDate) {
          return aDate.localeCompare(bDate);
        } else if (aDate) {
          return -1;
        } else if (bDate) {
          return 1;
        } else {
          return a.child_order - b.child_order;
        }
      });
    } else {
      // Default sort by child_order
      sortedItems = filteredItems.sort((a, b) => a.child_order - b.child_order);
    }

    // Apply limit if specified
    const limitedItems = args.limit && args.limit > 0
      ? sortedItems.slice(0, args.limit)
      : sortedItems;

    // Get current user ID for assignee filtering
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;

    // Use provided assignee filter or default to 'not-assigned-to-others'
    const effectiveAssigneeFilter = args.assigneeFilter || 'not-assigned-to-others';

    // Apply global filters
    return applyGlobalFilters(limitedItems, {
      assigneeFilter: effectiveAssigneeFilter,
      currentUserId: userId,
    });
  },
});