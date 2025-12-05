import { useCallback, useEffect, useState } from "react"

import {
  findFirstAvailableList,
  findLastAvailableList,
  findNextEntity,
  findNextList,
  findPreviousEntity,
  findPreviousList,
  type TaskSelection,
} from "@/lib/navigation/taskNavigation"

type UseTaskSelectionParams<T> = {
  listIds: string[]
  getEntitiesForList: (listId: string) => T[]
  getEntityId: (entity: T) => string
}

/**
 * Hook to manage entity selection and navigation across lists
 *
 * Handles:
 * - Current selection state (which list and entity ID)
 * - Arrow key navigation (forward/backward through entities)
 * - Auto-selection of first available entity
 * - Entity removal (moving selection when focused entity is removed)
 */
export function useTaskSelection<T>({ listIds, getEntitiesForList, getEntityId }: UseTaskSelectionParams<T>) {
  const [selection, setSelection] = useState<TaskSelection>({ listId: null, entityId: null })

  const updateSelection = useCallback((updater: (prev: TaskSelection) => TaskSelection) => {
    setSelection((prev) => updater(prev))
  }, [])

  /**
   * Handle entity removal - called when focused entity is removed optimistically
   * Immediately moves cursor to next entity or next/prev list
   */
  const handleEntityRemoved = useCallback(
    (listId: string, removedEntityId: string) => {
      updateSelection((prev) => {
        // Only adjust if the removed entity was focused
        if (prev.listId !== listId || prev.entityId !== removedEntityId) return prev

        // Get current entities (after filtering out the removed one)
        const entities = getEntitiesForList(listId)

        // If list is empty, move to next or previous list
        if (entities.length === 0) {
          const next = findNextList(listIds, getEntitiesForList, getEntityId, listId)
            ?? findPreviousList(listIds, getEntitiesForList, getEntityId, listId)
          return next ?? { listId: null, entityId: null }
        }

        // Find next entity in list (after the removed one)
        const nextEntityId = findNextEntity(entities, getEntityId, removedEntityId)
          ?? getEntityId(entities[entities.length - 1])  // Or last if we were at the end

        return { listId, entityId: nextEntityId }
      })
    },
    [listIds, updateSelection, getEntitiesForList, getEntityId]
  )

  /**
   * Handle arrow key navigation (up/down)
   */
  const handleArrowNavigation = useCallback(
    (direction: 1 | -1) => {
      updateSelection((prev) => {
        if (listIds.length === 0) return prev

        const movingForward = direction === 1

        // No current selection - find first or last available
        if (!prev.listId || !prev.entityId) {
          const fallback = movingForward
            ? findFirstAvailableList(listIds, getEntitiesForList, getEntityId)
            : findLastAvailableList(listIds, getEntitiesForList, getEntityId)
          return fallback ?? prev
        }

        const currentListIndex = listIds.indexOf(prev.listId)

        // Current list not in list of IDs - find fallback
        if (currentListIndex === -1) {
          const fallback = movingForward
            ? findFirstAvailableList(listIds, getEntitiesForList, getEntityId)
            : findLastAvailableList(listIds, getEntitiesForList, getEntityId)
          return fallback ?? { listId: null, entityId: null }
        }

        const entities = getEntitiesForList(prev.listId)

        // Current list is empty - move to next or previous
        if (entities.length === 0) {
          const fallback = movingForward
            ? findNextList(listIds, getEntitiesForList, getEntityId, prev.listId)
            : findPreviousList(listIds, getEntitiesForList, getEntityId, prev.listId)
          return fallback ?? { listId: null, entityId: null }
        }

        // Try to move within current list
        const nextEntityId = movingForward
          ? findNextEntity(entities, getEntityId, prev.entityId)
          : findPreviousEntity(entities, getEntityId, prev.entityId)

        if (nextEntityId) {
          return { listId: prev.listId, entityId: nextEntityId }
        }

        // Move to next or previous list
        const nextList = movingForward
          ? findNextList(listIds, getEntitiesForList, getEntityId, prev.listId)
          : findPreviousList(listIds, getEntitiesForList, getEntityId, prev.listId)

        return nextList ?? prev
      })
    },
    [listIds, updateSelection, getEntitiesForList, getEntityId]
  )

  /**
   * Handle direct entity click
   */
  const handleEntityClick = useCallback(
    (listId: string, entityId: string) => {
      updateSelection(() => ({ listId, entityId }))
    },
    [updateSelection]
  )

  /**
   * Effect to handle list changes and ensure selection is valid
   */
  useEffect(() => {
    updateSelection((prev) => {
      // If current list is not in the new list of IDs, find fallback
      if (!prev.listId || !listIds.includes(prev.listId)) {
        const fallback = findFirstAvailableList(listIds, getEntitiesForList, getEntityId)
        return fallback ?? { listId: null, entityId: null }
      }

      const entities = getEntitiesForList(prev.listId)

      // If current list is empty, move to next or previous
      if (entities.length === 0) {
        const fallback =
          findNextList(listIds, getEntitiesForList, getEntityId, prev.listId)
          ?? findPreviousList(listIds, getEntitiesForList, getEntityId, prev.listId)
        return fallback ?? { listId: null, entityId: null }
      }

      // If current entity ID doesn't exist in list, select first entity
      if (prev.entityId && !entities.find(e => getEntityId(e) === prev.entityId)) {
        return { listId: prev.listId, entityId: getEntityId(entities[0]) }
      }

      return prev
    })
  }, [listIds, updateSelection, getEntitiesForList, getEntityId])

  /**
   * Effect to focus the selected element using native browser focus
   * This provides visual feedback and keyboard event handling
   */
  useEffect(() => {
    if (!selection.entityId) return

    const element = document.querySelector(
      `[data-entity-id="${selection.entityId}"]`
    ) as HTMLElement | null

    if (element) {
      element.focus()
    }
  }, [selection.entityId])

  return {
    selection,
    handleEntityRemoved,
    handleArrowNavigation,
    handleEntityClick,
  }
}
