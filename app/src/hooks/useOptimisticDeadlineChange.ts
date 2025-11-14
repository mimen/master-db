import { api } from "@/convex/_generated/api"

import { createOptimisticHook } from "./createOptimisticHook"

/**
 * Centralized hook for deadline changes with optimistic updates
 *
 * Works everywhere: badge clicks, keyboard shortcuts, dialogs
 * - Adds deadline update to optimistic context immediately
 * - Calls updateTask API with new deadline date
 * - On failure: removes from context (rollback)
 * - On success: TaskRow's useEffect clears it when DB syncs
 *
 * @example
 * // Set deadline
 * optimisticDeadlineChange(taskId, { date: "2025-01-20" })
 *
 * // Clear deadline
 * optimisticDeadlineChange(taskId, null)
 */
export const useOptimisticDeadlineChange = createOptimisticHook<
  [{ date: string } | null]
>({
  actionPath: api.todoist.publicActions.updateTask,
  messages: {
    loading: "Updating deadline...",
    success: "Deadline updated!",
    error: "Failed to update deadline"
  },
  createUpdate: (taskId, newDeadline) => ({
    taskId,
    type: "deadline-change",
    newDeadline,
    timestamp: Date.now()
  }),
  createActionArgs: (taskId, newDeadline) => ({
    todoistId: taskId,
    deadlineDate: newDeadline?.date ?? null
  })
})
