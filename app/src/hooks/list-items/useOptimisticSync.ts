import { useEffect } from 'react'

/**
 * Optimistic Update Sync Hook
 *
 * Automatically clears optimistic updates when DB state syncs to match the optimistic state.
 * Extracts the common useEffect pattern used to detect when optimistic updates should be removed.
 *
 * @example
 * ```tsx
 * function TaskRow({ task }: TaskRowProps) {
 *   const { getTaskUpdate, removeTaskUpdate } = useOptimisticUpdates()
 *   const optimisticUpdate = getTaskUpdate(task.todoist_id)
 *
 *   // Sync priority update
 *   useOptimisticSync({
 *     entity: task,
 *     optimisticUpdate,
 *     shouldClear: (task, update) =>
 *       update.type === 'priority-change' && task.priority === update.newPriority,
 *     onClear: () => removeTaskUpdate(task.todoist_id)
 *   })
 *
 *   // Sync text update
 *   useOptimisticSync({
 *     entity: task,
 *     optimisticUpdate,
 *     shouldClear: (task, update) =>
 *       update.type === 'text-change' &&
 *       update.newContent === task.content &&
 *       update.newDescription === (task.description ?? ''),
 *     onClear: () => removeTaskUpdate(task.todoist_id)
 *   })
 * }
 * ```
 */

interface UseOptimisticSyncOptions<TEntity, TUpdate> {
  /**
   * The entity from the database (source of truth)
   */
  entity: TEntity

  /**
   * The optimistic update (if any)
   */
  optimisticUpdate: TUpdate | undefined

  /**
   * Function to determine if optimistic update should be cleared
   * Returns true when DB state matches optimistic state
   */
  shouldClear: (entity: TEntity, update: TUpdate) => boolean

  /**
   * Callback to clear the optimistic update
   * Usually calls removeEntityUpdate(entityId)
   */
  onClear: () => void
}

/**
 * Hook that automatically clears optimistic updates when DB syncs
 *
 * Compares entity state with optimistic update using the provided comparator.
 * When DB state matches optimistic state (shouldClear returns true), calls onClear.
 *
 * This prevents the "flash" bug where UI briefly shows old state between
 * optimistic update removal and DB sync.
 *
 * @param options Sync configuration
 */
export function useOptimisticSync<TEntity, TUpdate>({
  entity,
  optimisticUpdate,
  shouldClear,
  onClear
}: UseOptimisticSyncOptions<TEntity, TUpdate>) {
  useEffect(() => {
    if (optimisticUpdate && shouldClear(entity, optimisticUpdate)) {
      onClear()
    }
  }, [entity, optimisticUpdate, shouldClear, onClear])
}
