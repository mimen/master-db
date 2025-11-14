import { flushSync } from "react-dom"

import { api } from "@/convex/_generated/api"
import { useOptimisticUpdates } from "@/contexts/OptimisticUpdatesContext"

import { useTodoistAction } from "./useTodoistAction"

/**
 * Centralized hook for project moves with optimistic updates
 *
 * Works everywhere: keyboard shortcuts, dialogs, inline clicks
 * - Adds task to optimistic context immediately
 * - Calls moveTask API
 * - Removes from context on completion (success or failure)
 *
 * TaskRow components check the context to decide if they should hide
 */
export function useOptimisticProjectMove() {
  const { addUpdate, removeUpdate } = useOptimisticUpdates()

  const moveTask = useTodoistAction(
    api.todoist.publicActions.moveTask,
    {
      loadingMessage: "Moving task...",
      successMessage: "Task moved!",
      errorMessage: "Failed to move task"
    }
  )

  return async (taskId: string, newProjectId: string) => {
    // Use flushSync to force immediate synchronous render before API call
    flushSync(() => {
      addUpdate({
        taskId,
        type: "project-move",
        newProjectId,
        timestamp: Date.now()
      })
    })

    // Call API in background
    await moveTask({
      todoistId: taskId,
      projectId: newProjectId
    })

    // Always remove from context after API completes (success or failure)
    // If successful, Convex reactivity will update the task
    // If failed, removing from context will show the original task again
    removeUpdate(taskId)
  }
}
