import { useCallback, useRef } from "react"

import type { TaskCounts } from "@/lib/navigation/taskNavigation"

/**
 * Hook to manage task counts across multiple lists
 *
 * Maintains a Map of listId -> task count and provides methods to update counts.
 * Used for navigation logic to determine which lists have available tasks.
 */
export function useTaskCounts() {
  const taskCountsRef = useRef<TaskCounts>(new Map())

  const updateTaskCount = useCallback((listId: string, count: number) => {
    taskCountsRef.current.set(listId, count)
  }, [])

  const resetTaskCounts = useCallback(() => {
    taskCountsRef.current = new Map()
  }, [])

  const getTaskCounts = useCallback(() => {
    return taskCountsRef.current
  }, [])

  return {
    taskCountsRef,
    updateTaskCount,
    resetTaskCounts,
    getTaskCounts,
  }
}
