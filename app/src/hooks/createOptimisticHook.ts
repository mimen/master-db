import { flushSync } from "react-dom"

import { useOptimisticUpdates, type OptimisticTaskUpdate } from "@/contexts/OptimisticUpdatesContext"

import { useTodoistAction } from "./useTodoistAction"

/**
 * Factory for creating optimistic update hooks with consistent behavior
 *
 * Pattern:
 * 1. Add optimistic update to context immediately (via flushSync)
 * 2. Call API in background
 * 3. On failure: remove optimistic update (rollback)
 * 4. On success: leave in context for TaskRow's useEffect to clear when DB syncs
 *
 * This prevents the "flash" bug where the UI briefly shows old state between
 * optimistic update removal and DB sync.
 */
export function createOptimisticHook<TParams extends any[]>(config: {
  actionPath: any
  messages: {
    loading: string
    success: string
    error: string
  }
  createUpdate: (taskId: string, ...params: TParams) => OptimisticTaskUpdate
  createActionArgs: (taskId: string, ...params: TParams) => any
}) {
  return function useOptimisticUpdate() {
    const { addUpdate, removeUpdate } = useOptimisticUpdates()

    const action = useTodoistAction(config.actionPath, {
      loadingMessage: config.messages.loading,
      successMessage: config.messages.success,
      errorMessage: config.messages.error
    })

    return async (taskId: string, ...params: TParams) => {
      // 1. Immediate optimistic update (instant UI feedback)
      flushSync(() => {
        addUpdate(config.createUpdate(taskId, ...params))
      })

      // 2. Background API call
      const result = await action(config.createActionArgs(taskId, ...params))

      // 3. Cleanup strategy
      // Only remove on failure - let TaskRow's useEffect remove on success when DB syncs
      // This prevents the flash bug
      if (result === null) {
        removeUpdate(taskId)
      }
    }
  }
}
