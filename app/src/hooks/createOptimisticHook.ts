import type { FunctionReference } from "convex/server"
import { useMutation } from "convex/react"
import { flushSync } from "react-dom"
import { toast } from "sonner"

import { useTodoistAction } from "./useTodoistAction"

import {
  useOptimisticUpdates,
  type OptimisticTaskUpdate,
  type OptimisticProjectUpdate,
  type OptimisticRoutineUpdate
} from "@/contexts/OptimisticUpdatesContext"

/**
 * Factory for creating optimistic update hooks with consistent behavior
 *
 * Pattern:
 * 1. Add optimistic update to context immediately (via flushSync)
 * 2. Call API in background
 * 3. On failure: remove optimistic update (rollback)
 * 4. On success: leave in context for component's useEffect to clear when DB syncs
 *
 * This prevents the "flash" bug where the UI briefly shows old state between
 * optimistic update removal and DB sync.
 */
export function createOptimisticHook<TParams extends unknown[], TArgs, TResult>(config: {
  actionPath: FunctionReference<"action", "public", TArgs, TResult>
  messages: {
    loading: string
    success: string
    error: string
  }
  createUpdate: (taskId: string, ...params: TParams) => OptimisticTaskUpdate
  createActionArgs: (taskId: string, ...params: TParams) => TArgs
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
      // Only remove on failure - let component's useEffect remove on success when DB syncs
      // This prevents the flash bug
      if (result === null) {
        removeUpdate(taskId)
      }
    }
  }
}

/**
 * Factory for creating optimistic update hooks for projects
 *
 * Same pattern as createOptimisticHook but for project entities
 */
export function createOptimisticProjectHook<TParams extends unknown[], TArgs, TResult>(config: {
  actionPath: FunctionReference<"action", "public", TArgs, TResult>
  messages: {
    loading: string
    success: string
    error: string
  }
  createUpdate: (projectId: string, ...params: TParams) => OptimisticProjectUpdate
  createActionArgs: (projectId: string, ...params: TParams) => TArgs
}) {
  return function useOptimisticProjectUpdate() {
    const { addProjectUpdate, removeProjectUpdate } = useOptimisticUpdates()

    const action = useTodoistAction(config.actionPath, {
      loadingMessage: config.messages.loading,
      successMessage: config.messages.success,
      errorMessage: config.messages.error
    })

    return async (projectId: string, ...params: TParams) => {
      // 1. Immediate optimistic update (instant UI feedback)
      flushSync(() => {
        addProjectUpdate(config.createUpdate(projectId, ...params))
      })

      // 2. Background API call
      const result = await action(config.createActionArgs(projectId, ...params))

      // 3. Cleanup strategy
      // Only remove on failure - let component's useEffect remove on success when DB syncs
      if (result === null) {
        removeProjectUpdate(projectId)
      }
    }
  }
}

/**
 * Factory for creating optimistic update hooks for routines
 *
 * Uses mutations directly instead of actions (routines are internal to Convex)
 */
export function createOptimisticRoutineHook<TParams extends unknown[], TArgs, TResult>(config: {
  mutationPath: FunctionReference<"mutation", "internal", TArgs, TResult>
  messages: {
    loading: string
    success: string
    error: string
  }
  createUpdate: (routineId: string, ...params: TParams) => OptimisticRoutineUpdate
  createMutationArgs: (routineId: string, ...params: TParams) => TArgs
}) {
  return function useOptimisticRoutineUpdate() {
    const { addRoutineUpdate, removeRoutineUpdate } = useOptimisticUpdates()
    const mutation = useMutation(config.mutationPath)

    return async (routineId: string, ...params: TParams) => {
      const toastId = toast.loading(config.messages.loading)

      try {
        // 1. Immediate optimistic update (instant UI feedback)
        flushSync(() => {
          addRoutineUpdate(config.createUpdate(routineId, ...params))
        })

        // 2. Background mutation call
        await mutation(config.createMutationArgs(routineId, ...params))

        // 3. Success
        toast.success(config.messages.success, { id: toastId })
      } catch (error) {
        // 4. Failure - rollback optimistic update
        removeRoutineUpdate(routineId)
        const msg = error instanceof Error ? error.message : "Unknown error"
        toast.error(`${config.messages.error}: ${msg}`, { id: toastId })
      }
    }
  }
}
