import { useAction } from "convex/react"
import type { FunctionReference } from "convex/server"
import { toast } from "sonner"

interface TodoistActionConfig {
  loadingMessage: string
  successMessage: string
  errorMessage?: string
}

/**
 * SINGLE CODEPATH for all Todoist actions
 *
 * Automatically adds:
 * 1. Loading toast
 * 2. Success toast
 * 3. Error handling with user-friendly messages
 *
 * The action itself handles optimistic updates and rollback.
 *
 * @example
 * const completeTask = useTodoistAction(
 *   api.todoist.publicActions.completeTask,
 *   {
 *     loadingMessage: "Completing task...",
 *     successMessage: "Task completed!",
 *     errorMessage: "Failed to complete task"
 *   }
 * )
 *
 * await completeTask({ todoistId: "123" })
 */
export function useTodoistAction<T = unknown>(
  actionRef: FunctionReference<"action">,
  config: TodoistActionConfig
) {
  const baseAction = useAction(actionRef)

  return async (args: Record<string, unknown>): Promise<T | null> => {
    const toastId = toast.loading(config.loadingMessage)

    try {
      const result = await baseAction(args)

      // Handle ActionResponse pattern from your codebase
      if (result && typeof result === "object" && "success" in result) {
        if (!result.success) {
          toast.error(
            result.error || config.errorMessage || "Action failed",
            { id: toastId }
          )
          return null
        }
        toast.success(config.successMessage, { id: toastId })
        return result.data
      }

      // Handle direct return values
      toast.success(config.successMessage, { id: toastId })
      return result
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error"
      toast.error(config.errorMessage || `Failed: ${msg}`, { id: toastId })
      return null
    }
  }
}
