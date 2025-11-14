import { api } from "@/convex/_generated/api"

import { createOptimisticHook } from "./createOptimisticHook"

/**
 * Centralized hook for task completion with optimistic updates
 *
 * Works everywhere: checkbox clicks, keyboard shortcuts, dialogs
 * - Adds task to optimistic context immediately (task disappears)
 * - Calls completeTask API
 * - On failure: removes optimistic update to show task again
 * - On success: task stays hidden (Convex removes it from queries naturally)
 */
export const useOptimisticTaskComplete = createOptimisticHook<[]>({
  actionPath: api.todoist.publicActions.completeTask,
  messages: {
    loading: "Completing task...",
    success: "Task completed!",
    error: "Failed to complete task"
  },
  createUpdate: (taskId) => ({
    taskId,
    type: "task-complete",
    timestamp: Date.now()
  }),
  createActionArgs: (taskId) => ({
    todoistId: taskId
  })
})
