import { createOptimisticHook } from "./createOptimisticHook"

import { api } from "@/convex/_generated/api"

/**
 * Centralized hook for schedule (due date) changes with optimistic updates
 *
 * Works everywhere: badge clicks, keyboard shortcuts, dialogs
 * - Adds schedule update to optimistic context immediately
 * - Calls updateTask API with new schedule date/datetime
 * - On failure: removes from context (rollback)
 * - On success: TaskRow's useEffect clears it when DB syncs
 *
 * @example
 * // Set date-only schedule
 * optimisticDueChange(taskId, { date: "2025-01-15" })
 *
 * // Set datetime schedule
 * optimisticDueChange(taskId, { date: "2025-01-15", datetime: "2025-01-15T19:00:00Z" })
 *
 * // Clear schedule
 * optimisticDueChange(taskId, null)
 */
export const useOptimisticDueChange = createOptimisticHook<
  [{ date: string; datetime?: string } | null]
>({
  actionPath: api.todoist.actions.updateTask.updateTask,
  messages: {
    loading: "Updating schedule...",
    success: "Schedule updated!",
    error: "Failed to update schedule"
  },
  createUpdate: (taskId, newDue) => ({
    taskId,
    type: "due-change",
    newDue,
    timestamp: Date.now()
  }),
  createActionArgs: (taskId, newDue) => {
    if (newDue === null) {
      // Clear due date by setting to "no date"
      return {
        todoistId: taskId,
        dueString: "no date"
      }
    }

    // Set due date/datetime
    if (newDue.datetime) {
      // Has time component
      return {
        todoistId: taskId,
        dueDatetime: newDue.datetime
      }
    } else {
      // Date-only
      return {
        todoistId: taskId,
        dueDate: newDue.date
      }
    }
  }
})
