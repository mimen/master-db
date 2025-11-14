import { createOptimisticHook } from "./createOptimisticHook"

import { api } from "@/convex/_generated/api"

/**
 * Centralized hook for priority changes with optimistic updates
 *
 * Works everywhere: badge clicks, keyboard shortcuts, dialogs
 * - Adds priority update to optimistic context immediately
 * - Calls updateTask API with new priority
 * - On failure: removes from context (rollback)
 * - On success: TaskRow's useEffect clears it when DB syncs
 */
export const useOptimisticPriorityChange = createOptimisticHook<[number]>({
  actionPath: api.todoist.publicActions.updateTask,
  messages: {
    loading: "Updating priority...",
    success: "Priority updated!",
    error: "Failed to update priority"
  },
  createUpdate: (taskId, newPriority) => ({
    taskId,
    type: "priority-change",
    newPriority,
    timestamp: Date.now()
  }),
  createActionArgs: (taskId, newPriority) => ({
    todoistId: taskId,
    priority: newPriority
  })
})
