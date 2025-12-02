/**
 * Task Navigation Utilities
 *
 * Pure functions for navigating between entities across multiple lists.
 * These handle finding next/previous entities and navigating between lists.
 */

export type TaskSelection = {
  listId: string | null
  entityId: string | null
}

// Legacy type for backwards compatibility
export type TaskCounts = Map<string, number>

/**
 * Find the next entity in a list after the current entity
 */
export function findNextEntity<T>(
  entities: T[],
  getEntityId: (entity: T) => string,
  currentEntityId: string
): string | null {
  const currentIndex = entities.findIndex(e => getEntityId(e) === currentEntityId)
  if (currentIndex === -1 || currentIndex === entities.length - 1) return null
  return getEntityId(entities[currentIndex + 1])
}

/**
 * Find the previous entity in a list before the current entity
 */
export function findPreviousEntity<T>(
  entities: T[],
  getEntityId: (entity: T) => string,
  currentEntityId: string
): string | null {
  const currentIndex = entities.findIndex(e => getEntityId(e) === currentEntityId)
  if (currentIndex <= 0) return null
  return getEntityId(entities[currentIndex - 1])
}

/**
 * Find the first list that has tasks available
 * Returns the first entity ID in that list
 */
export function findFirstAvailableList<T>(
  listIds: string[],
  getEntitiesForList: (listId: string) => T[],
  getEntityId: (entity: T) => string
): TaskSelection | null {
  for (const listId of listIds) {
    const entities = getEntitiesForList(listId)
    if (entities.length > 0) {
      return { listId, entityId: getEntityId(entities[0]) }
    }
  }
  return null
}

/**
 * Find the last list that has tasks available (starts at end of list)
 * Returns the last entity ID in that list
 */
export function findLastAvailableList<T>(
  listIds: string[],
  getEntitiesForList: (listId: string) => T[],
  getEntityId: (entity: T) => string
): TaskSelection | null {
  for (let index = listIds.length - 1; index >= 0; index -= 1) {
    const listId = listIds[index]
    const entities = getEntitiesForList(listId)
    if (entities.length > 0) {
      return { listId, entityId: getEntityId(entities[entities.length - 1]) }
    }
  }
  return null
}

/**
 * Find the next list with tasks after the current list
 * Returns the first entity ID in that list
 */
export function findNextList<T>(
  listIds: string[],
  getEntitiesForList: (listId: string) => T[],
  getEntityId: (entity: T) => string,
  currentListId: string
): TaskSelection | null {
  const startIndex = listIds.indexOf(currentListId)
  if (startIndex === -1) return null

  for (let index = startIndex + 1; index < listIds.length; index += 1) {
    const listId = listIds[index]
    const entities = getEntitiesForList(listId)
    if (entities.length > 0) {
      return { listId, entityId: getEntityId(entities[0]) }
    }
  }

  return null
}

/**
 * Find the previous list with tasks before the current list
 * Returns the last entity ID in that list
 */
export function findPreviousList<T>(
  listIds: string[],
  getEntitiesForList: (listId: string) => T[],
  getEntityId: (entity: T) => string,
  currentListId: string
): TaskSelection | null {
  const startIndex = listIds.indexOf(currentListId)
  if (startIndex === -1) return null

  for (let index = startIndex - 1; index >= 0; index -= 1) {
    const listId = listIds[index]
    const entities = getEntitiesForList(listId)
    if (entities.length > 0) {
      return { listId, entityId: getEntityId(entities[entities.length - 1]) }
    }
  }

  return null
}
