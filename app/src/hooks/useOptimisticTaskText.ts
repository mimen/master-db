import { flushSync } from "react-dom"

import { useTodoistAction } from "./useTodoistAction"

import { useOptimisticUpdates } from "@/contexts/OptimisticUpdatesContext"
import { api } from "@/convex/_generated/api"

/**
 * Centralized hook for task text (content and/or description) updates with optimistic updates
 *
 * - Adds task to optimistic context immediately (text changes instantly)
 * - Calls updateTask API
 * - On failure: removes optimistic update to revert text
 * - On success: text stays updated (Convex syncs naturally)
 *
 * Usage:
 * ```
 * const updateTaskText = useOptimisticTaskText()
 * await updateTaskText(taskId, { content: "New title", description: "New desc" })
 * ```
 */
export function useOptimisticTaskText() {
  const { addTaskUpdate, removeTaskUpdate } = useOptimisticUpdates()

  const action = useTodoistAction(api.todoist.publicActions.updateTask, {
    loadingMessage: "Updating task...",
    successMessage: "Task updated!",
    errorMessage: "Failed to update task"
  })

  return async (
    taskId: string,
    changes: {
      content?: string
      description?: string
    }
  ) => {
    // 1. Immediate optimistic update (instant UI feedback)
    flushSync(() => {
      addTaskUpdate({
        taskId,
        type: "text-change",
        newContent: changes.content,
        newDescription: changes.description,
        timestamp: Date.now()
      })
    })

    // 2. Background API call
    const result = await action({
      todoistId: taskId,
      ...changes
    })

    // 3. Cleanup strategy
    // Only remove on failure - let component's useEffect remove on success when DB syncs
    if (result === null) {
      removeTaskUpdate(taskId)
    }
  }
}
