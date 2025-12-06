/**
 * Client-side filter matcher for optimistic cursor updates
 *
 * Dispatches to appropriate filter predicate based on query type.
 * Uses shared predicates from Convex server for single source of truth.
 */

import {
  matchesProjectFilter,
  matchesPriorityFilter,
  matchesLabelFilter,
  matchesTodayFilter,
  matchesNext7DaysFilter,
} from "../../../../convex/todoist/helpers/cursorFilters"
import type { ListQueryInput } from "@/lib/views/types"
import type { TodoistTaskWithProject } from "@/types/convex/todoist"

/**
 * Check if entity still matches the view's filter after optimistic update
 *
 * @param query View query definition
 * @param entity Entity with optimistic updates applied
 * @returns true if entity should remain visible, false if cursor should move
 */
export function matchesViewFilter(
  query: ListQueryInput,
  entity: TodoistTaskWithProject
): boolean {
  // Completed tasks should be removed from ALL active task views
  if (entity.checked) {
    return false
  }

  switch (query.type) {
    case "inbox":
      // Inbox is typically a specific project or default project
      if (query.inboxProjectId) {
        return matchesProjectFilter(entity, query.inboxProjectId)
      }
      // No specific filter - entity always matches
      return true

    case "project":
      return matchesProjectFilter(entity, query.projectId)

    case "priority":
      return matchesPriorityFilter(entity, query.priority)

    case "label":
      return matchesLabelFilter(entity, query.label)

    case "time":
      // Dispatch based on time range
      switch (query.range) {
        case "today":
          return matchesTodayFilter(entity, query.timezoneOffsetMinutes ?? 0)

        case "upcoming":
          // Upcoming = next 7 days (excluding today)
          return matchesNext7DaysFilter(entity, query.timezoneOffsetMinutes ?? 0)

        case "overdue":
          // Overdue tasks have due date before today
          if (!entity.due?.date) return false
          const offsetMs = (query.timezoneOffsetMinutes ?? 0) * 60 * 1000
          const nowUTC = Date.now()
          const nowLocal = new Date(nowUTC + offsetMs)
          const year = nowLocal.getUTCFullYear()
          const month = String(nowLocal.getUTCMonth() + 1).padStart(2, "0")
          const day = String(nowLocal.getUTCDate()).padStart(2, "0")
          const todayLocalDate = `${year}-${month}-${day}`
          const dueDate = entity.due.date.includes("T")
            ? entity.due.date.split("T")[0]
            : entity.due.date
          return dueDate < todayLocalDate

        case "no-date":
          // No date means no due field
          return !entity.due

        default:
          // Unknown time range - don't remove
          return true
      }

    case "projects":
    case "routines":
    case "routine-tasks":
      // These query types don't apply to tasks - always match
      // (cursor updates only apply to task lists)
      return true

    default:
      // Unknown query type - don't remove to be safe
      return true
  }
}
