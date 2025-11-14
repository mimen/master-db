import { api } from "@/convex/_generated/api"

import { createOptimisticHook } from "./createOptimisticHook"

/**
 * Centralized hook for project moves with optimistic updates
 *
 * Works everywhere: keyboard shortcuts, dialogs, badge clicks
 * - Adds task to optimistic context immediately
 * - Calls moveTask API
 * - On failure: removes from context (rollback)
 * - On success: Convex reactivity updates the task in place (or hides in project views)
 */
export const useOptimisticProjectMove = createOptimisticHook<[string]>({
  actionPath: api.todoist.publicActions.moveTask,
  messages: {
    loading: "Moving task...",
    success: "Task moved!",
    error: "Failed to move task"
  },
  createUpdate: (taskId, newProjectId) => ({
    taskId,
    type: "project-move",
    newProjectId,
    timestamp: Date.now()
  }),
  createActionArgs: (taskId, newProjectId) => ({
    todoistId: taskId,
    projectId: newProjectId
  })
})
