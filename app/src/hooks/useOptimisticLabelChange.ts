import { createOptimisticHook } from "./createOptimisticHook"

import { api } from "@/convex/_generated/api"

/**
 * Centralized hook for label changes with optimistic updates
 *
 * Works everywhere: label dialog, keyboard shortcuts
 * - Adds label update to optimistic context immediately
 * - Calls updateTask API with new labels
 * - On failure: removes from context (rollback)
 * - On success: TaskRow's useEffect clears it when DB syncs
 */
export const useOptimisticLabelChange = createOptimisticHook<[string[]]>({
  actionPath: api.todoist.publicActions.updateTask,
  messages: {
    loading: "Updating labels...",
    success: "Labels updated!",
    error: "Failed to update labels"
  },
  createUpdate: (taskId, newLabels) => ({
    taskId,
    type: "label-change",
    newLabels,
    timestamp: Date.now()
  }),
  createActionArgs: (taskId, newLabels) => ({
    todoistId: taskId,
    labels: newLabels
  })
})
