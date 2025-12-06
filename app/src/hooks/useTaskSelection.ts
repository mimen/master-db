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
        if (prev.listId !== listId || prev.entityId !== removedEntityId) {
          return prev
        }

        // Get all entities and filter out the removed one explicitly
        // (The parent might not have re-rendered yet, so the removed entity might still be in the list)
        const allEntities = getEntitiesForList(listId)
        const entities = allEntities.filter(e => getEntityId(e) !== removedEntityId)

        // If list is empty after filtering, move to next or previous list
        if (entities.length === 0) {
          const next = findNextList(listIds, getEntitiesForList, getEntityId, listId)
            ?? findPreviousList(listIds, getEntitiesForList, getEntityId, listId)
          return next ?? { listId: null, entityId: null }
        }

        // Find the index where the removed entity was in the original list
        const removedIndex = allEntities.findIndex(e => getEntityId(e) === removedEntityId)

        if (removedIndex === -1) {
          // Entity not found in original list - just select first available
          return { listId, entityId: getEntityId(entities[0]) }
        }

        // Try to select the entity at the same index (which is now the "next" one)
        if (removedIndex < entities.length) {
          return { listId, entityId: getEntityId(entities[removedIndex]) }
        }

        // Removed entity was at the end - select the last available entity (previous one)
        return { listId, entityId: getEntityId(entities[entities.length - 1]) }
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
   * This validates the selection whenever entities change (e.g., after optimistic updates)
   */
  useEffect(() => {
    updateSelection((prev) => {
      // No selection to validate
      if (!prev.listId || !prev.entityId) {
        // If we have entities but no selection, select the first one
        const fallback = findFirstAvailableList(listIds, getEntitiesForList, getEntityId)
        return fallback ?? prev
      }

      // If current list is not in the new list of IDs, find fallback
      if (!listIds.includes(prev.listId)) {
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

      // If current entity ID doesn't exist in list, select first entity in current list
      if (!entities.find(e => getEntityId(e) === prev.entityId)) {
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

    const tryFocus = (attempt = 1, maxAttempts = 5) => {
      const element = document.querySelector(
        `[data-entity-id="${selection.entityId}"]`
      ) as HTMLElement | null

      if (element) {
        element.focus()
      } else if (attempt < maxAttempts) {
        // Element not found yet - might be mid-render. Retry after React updates DOM.
        setTimeout(() => tryFocus(attempt + 1, maxAttempts), 10)
      }
      // If we still can't find it after max attempts, the validation effect will handle recovery
    }

    tryFocus()
  }, [selection.entityId])

  return {
    selection,
    handleEntityRemoved,
    handleArrowNavigation,
    handleEntityClick,
  }
}
