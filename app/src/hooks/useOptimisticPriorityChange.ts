import { flushSync } from "react-dom"

import { api } from "@/convex/_generated/api"
import { useOptimisticUpdates } from "@/contexts/OptimisticUpdatesContext"

import { useTodoistAction } from "./useTodoistAction"

/**
 * Centralized hook for priority changes with optimistic updates
 *
 * Works everywhere: badge clicks, keyboard shortcuts, dialogs
 * - Adds priority update to optimistic context immediately
 * - Calls updateTask API with new priority
 * - Removes from context on completion (success or failure)
 *
 * TaskRow components check the context to display optimistic priority
 */
export function useOptimisticPriorityChange() {
  const { addUpdate, removeUpdate } = useOptimisticUpdates()

  const updateTask = useTodoistAction(
    api.todoist.publicActions.updateTask,
    {
      loadingMessage: "Updating priority...",
      successMessage: "Priority updated!",
      errorMessage: "Failed to update priority"
    }
  )

  return async (taskId: string, newPriority: number) => {
    // Use flushSync to force immediate synchronous render before API call
    flushSync(() => {
      addUpdate({
        taskId,
        type: "priority-change",
        newPriority,
        timestamp: Date.now()
      })
    })

    // Call API in background
    const result = await updateTask({
      todoistId: taskId,
      priority: newPriority
    })

    // If API failed, remove optimistic update immediately to show original value
    // If successful, TaskRow will clear it via useEffect when DB value syncs
    if (result === null) {
      removeUpdate(taskId)
    }
  }
}
