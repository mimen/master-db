/**
 * Task Navigation Utilities
 *
 * Pure functions for navigating between tasks across multiple lists.
 * These handle finding available lists and tasks based on task counts.
 */

export type TaskSelection = {
  listId: string | null
  taskIndex: number | null
}

export type TaskCounts = Map<string, number>

/**
 * Find the first list that has tasks available
 */
export function findFirstAvailableList(
  listIds: string[],
  counts: TaskCounts
): TaskSelection | null {
  for (const listId of listIds) {
    const count = counts.get(listId) ?? 0
    if (count > 0) {
      return { listId, taskIndex: 0 }
    }
  }
  return null
}

/**
 * Find the last list that has tasks available (starts at end of list)
 */
export function findLastAvailableList(
  listIds: string[],
  counts: TaskCounts
): TaskSelection | null {
  for (let index = listIds.length - 1; index >= 0; index -= 1) {
    const listId = listIds[index]
    const count = counts.get(listId) ?? 0
    if (count > 0) {
      return { listId, taskIndex: count - 1 }
    }
  }
  return null
}

/**
 * Find the next list with tasks after the current list
 */
export function findNextList(
  listIds: string[],
  counts: TaskCounts,
  currentListId: string
): TaskSelection | null {
  const startIndex = listIds.indexOf(currentListId)
  if (startIndex === -1) return null

  for (let index = startIndex + 1; index < listIds.length; index += 1) {
    const listId = listIds[index]
    const count = counts.get(listId) ?? 0
    if (count > 0) {
      return { listId, taskIndex: 0 }
    }
  }

  return null
}

/**
 * Find the previous list with tasks before the current list
 */
export function findPreviousList(
  listIds: string[],
  counts: TaskCounts,
  currentListId: string
): TaskSelection | null {
  const startIndex = listIds.indexOf(currentListId)
  if (startIndex === -1) return null

  for (let index = startIndex - 1; index >= 0; index -= 1) {
    const listId = listIds[index]
    const count = counts.get(listId) ?? 0
    if (count > 0) {
      return { listId, taskIndex: count - 1 }
    }
  }

  return null
}
