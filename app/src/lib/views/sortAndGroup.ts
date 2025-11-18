import type { SortOption, GroupOption, GroupData } from "./types"

/**
 * Result of grouping: entities organized by group key
 */
export interface GroupedEntities<T> {
  groupKey: string
  groupLabel: string
  entities: T[]
}

/**
 * Apply sorting to an array of entities
 * Returns new sorted array (does not mutate original)
 */
export function applySorting<T>(
  entities: T[],
  sortOption: SortOption<T> | null | undefined
): T[] {
  if (!sortOption) {
    return entities
  }

  return [...entities].sort(sortOption.compareFn)
}

/**
 * Apply grouping to an array of entities
 * Returns grouped and sorted entities, or null if no grouping
 */
export function applyGrouping<T>(
  entities: T[],
  groupOption: GroupOption<T> | null | undefined,
  groupData: GroupData | undefined
): GroupedEntities<T>[] | null {
  if (!groupOption) {
    return null
  }

  // Build map of group key -> entities in that group
  const groupMap = new Map<string, T[]>()

  entities.forEach((entity) => {
    const groupKey = groupOption.groupFn(entity) ?? "ungrouped"

    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, [])
    }

    groupMap.get(groupKey)!.push(entity)
  })

  // Sort the groups if group has a custom sort function
  const sortedGroupKeys = Array.from(groupMap.keys()).sort((a, b) => {
    if (groupOption.groupSort) {
      return groupOption.groupSort(a, b)
    }
    // Default: alphabetical sort
    return a.localeCompare(b)
  })

  // Build result with group labels
  const result: GroupedEntities<T>[] = sortedGroupKeys.map((groupKey) => ({
    groupKey,
    groupLabel: groupOption.getGroupLabel(groupKey, groupData ?? {}),
    entities: groupMap.get(groupKey)!,
  }))

  return result
}

/**
 * Apply both grouping and sorting to entities
 * Grouping is applied first, then sorting within each group
 */
export function applyGroupingAndSorting<T>(
  entities: T[],
  sortOption: SortOption<T> | null | undefined,
  groupOption: GroupOption<T> | null | undefined,
  groupData: GroupData | undefined
): GroupedEntities<T>[] | T[] {
  // Apply grouping first
  const groupedData = applyGrouping(entities, groupOption, groupData)

  if (groupedData) {
    // Apply sorting within each group
    return groupedData.map((group) => ({
      ...group,
      entities: applySorting(group.entities, sortOption),
    }))
  }

  // No grouping, just sort flat array
  return applySorting(entities, sortOption)
}
