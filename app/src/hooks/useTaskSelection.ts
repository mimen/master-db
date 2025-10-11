import { useCallback, useEffect, useState } from "react"

import {
  findFirstAvailableList,
  findLastAvailableList,
  findNextList,
  findPreviousList,
  type TaskCounts,
  type TaskSelection,
} from "@/lib/navigation/taskNavigation"

type UseTaskSelectionParams = {
  listIds: string[]
  getTaskCounts: () => TaskCounts
}

/**
 * Hook to manage task selection and navigation across lists
 *
 * Handles:
 * - Current selection state (which list and task index)
 * - Arrow key navigation (forward/backward through tasks)
 * - Auto-selection of first available task
 * - Task count changes (moving selection when task is deleted)
 */
export function useTaskSelection({ listIds, getTaskCounts }: UseTaskSelectionParams) {
  const [selection, setSelection] = useState<TaskSelection>({ listId: null, taskIndex: null })

  const updateSelection = useCallback((updater: (prev: TaskSelection) => TaskSelection) => {
    setSelection((prev) => updater(prev))
  }, [])

  /**
   * Handle task count changes for a specific list
   * Adjusts selection if the current task is affected
   */
  const handleTaskCountChange = useCallback(
    (listId: string, count: number) => {
      updateSelection((prev) => {
        const counts = getTaskCounts()

        // If no selection yet, select first available task
        if (!prev.listId || prev.taskIndex === null) {
          const firstAvailable = findFirstAvailableList(listIds, counts)
          return firstAvailable ?? prev
        }

        // If the changed list is the currently selected one
        if (prev.listId === listId) {
          // If list is now empty, move to next or previous list
          if (count === 0) {
            const next = findNextList(listIds, counts, listId) ?? findPreviousList(listIds, counts, listId)
            return next ?? { listId: null, taskIndex: null }
          }

          // If current task index is out of bounds, select last task
          if (prev.taskIndex >= count) {
            return { listId, taskIndex: count - 1 }
          }
        }

        return prev
      })
    },
    [listIds, updateSelection, getTaskCounts]
  )

  /**
   * Handle arrow key navigation (up/down)
   */
  const handleArrowNavigation = useCallback(
    (direction: 1 | -1) => {
      updateSelection((prev) => {
        const counts = getTaskCounts()

        if (listIds.length === 0) return prev

        const movingForward = direction === 1

        // No current selection - find first or last available
        if (!prev.listId || prev.taskIndex === null) {
          const fallback = movingForward
            ? findFirstAvailableList(listIds, counts)
            : findLastAvailableList(listIds, counts)
          return fallback ?? prev
        }

        const currentIndex = listIds.indexOf(prev.listId)

        // Current list not in list of IDs - find fallback
        if (currentIndex === -1) {
          const fallback = movingForward
            ? findFirstAvailableList(listIds, counts)
            : findLastAvailableList(listIds, counts)
          return fallback ?? { listId: null, taskIndex: null }
        }

        const currentCount = counts.get(prev.listId) ?? 0

        // Current list is empty - move to next or previous
        if (currentCount === 0) {
          const fallback = movingForward
            ? findNextList(listIds, counts, prev.listId)
            : findPreviousList(listIds, counts, prev.listId)
          return fallback ?? { listId: null, taskIndex: null }
        }

        // Moving forward
        if (movingForward) {
          // Can move within current list
          if ((prev.taskIndex ?? 0) + 1 < currentCount) {
            return { listId: prev.listId, taskIndex: (prev.taskIndex ?? 0) + 1 }
          }
          // Move to next list
          const next = findNextList(listIds, counts, prev.listId)
          return next ?? prev
        }

        // Moving backward - can move within current list
        if ((prev.taskIndex ?? 0) > 0) {
          return { listId: prev.listId, taskIndex: (prev.taskIndex ?? 0) - 1 }
        }

        // Move to previous list
        const previous = findPreviousList(listIds, counts, prev.listId)
        return previous ?? prev
      })
    },
    [listIds, updateSelection, getTaskCounts]
  )

  /**
   * Handle direct task click
   */
  const handleTaskClick = useCallback(
    (listId: string, taskIndex: number) => {
      updateSelection(() => ({ listId, taskIndex }))
    },
    [updateSelection]
  )

  /**
   * Effect to handle list changes and ensure selection is valid
   */
  useEffect(() => {
    updateSelection((prev) => {
      const counts = getTaskCounts()

      // If current list is not in the new list of IDs, find fallback
      if (!prev.listId || !listIds.includes(prev.listId)) {
        const fallback = findFirstAvailableList(listIds, counts)
        return fallback ?? { listId: null, taskIndex: null }
      }

      const currentCount = counts.get(prev.listId) ?? 0

      // If current list is empty, move to next or previous
      if (currentCount === 0) {
        const fallback =
          findNextList(listIds, counts, prev.listId) ?? findPreviousList(listIds, counts, prev.listId)
        return fallback ?? { listId: null, taskIndex: null }
      }

      // If task index is out of bounds, select last task
      if ((prev.taskIndex ?? 0) >= currentCount) {
        return { listId: prev.listId, taskIndex: currentCount - 1 }
      }

      return prev
    })
  }, [listIds, updateSelection, getTaskCounts])

  return {
    selection,
    handleTaskCountChange,
    handleArrowNavigation,
    handleTaskClick,
  }
}
