import { useAction, useMutation } from "convex/react"
import { toast } from "sonner"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"

/**
 * Hook providing all routine CRUD operations with toast notifications
 */
export function useRoutineActions() {
  const createRoutineMutation = useMutation(api.routines.internalMutations.createRoutine.createRoutine)
  const updateRoutineMutation = useMutation(api.routines.internalMutations.updateRoutine.updateRoutine)
  const deleteRoutineMutation = useMutation(api.routines.internalMutations.deleteRoutine.deleteRoutine)
  const deferRoutineMutation = useMutation(api.routines.internalMutations.deferRoutine.deferRoutine)
  const undeferRoutineMutation = useMutation(api.routines.internalMutations.undeferRoutine.undeferRoutine)
  const generateTasksAction = useAction(api.routines.internalActions.manuallyGenerateRoutineTasks.manuallyGenerateRoutineTasks)

  const createRoutine = async (args: {
    name: string
    description?: string
    frequency: string
    duration?: string
    timeOfDay?: string
    idealDay?: number
    todoistProjectId?: string
    todoistLabels?: string[]
    priority?: number
  }): Promise<Id<"routines"> | null> => {
    const toastId = toast.loading("Creating routine...")

    try {
      const routineId = await createRoutineMutation(args)
      toast.success("Routine created!", { id: toastId })
      return routineId
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error"
      toast.error(`Failed to create routine: ${msg}`, { id: toastId })
      return null
    }
  }

  const updateRoutine = async (args: {
    routineId: Id<"routines">
    name?: string
    description?: string
    frequency?: string
    duration?: string
    timeOfDay?: string
    idealDay?: number
    todoistProjectId?: string
    todoistLabels?: string[]
    priority?: number
  }): Promise<boolean> => {
    const toastId = toast.loading("Updating routine...")

    try {
      await updateRoutineMutation(args)
      toast.success("Routine updated!", { id: toastId })
      return true
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error"
      toast.error(`Failed to update routine: ${msg}`, { id: toastId })
      return false
    }
  }

  const deleteRoutine = async (routineId: Id<"routines">): Promise<boolean> => {
    const toastId = toast.loading("Deleting routine...")

    try {
      await deleteRoutineMutation({ routineId })
      toast.success("Routine deleted!", { id: toastId })
      return true
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error"
      toast.error(`Failed to delete routine: ${msg}`, { id: toastId })
      return false
    }
  }

  const deferRoutine = async (routineId: Id<"routines">): Promise<boolean> => {
    const toastId = toast.loading("Pausing routine...")

    try {
      await deferRoutineMutation({ routineId })
      toast.success("Routine paused!", { id: toastId })
      return true
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error"
      toast.error(`Failed to pause routine: ${msg}`, { id: toastId })
      return false
    }
  }

  const undeferRoutine = async (routineId: Id<"routines">): Promise<boolean> => {
    const toastId = toast.loading("Resuming routine...")

    try {
      await undeferRoutineMutation({ routineId })
      toast.success("Routine resumed!", { id: toastId })
      return true
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error"
      toast.error(`Failed to resume routine: ${msg}`, { id: toastId })
      return false
    }
  }

  const generateRoutineTasks = async (): Promise<boolean> => {
    const toastId = toast.loading("Generating routine tasks...")

    try {
      const result = await generateTasksAction({})
      const message = result.totalTasksCreated > 0
        ? `Generated ${result.totalTasksCreated} task${result.totalTasksCreated === 1 ? '' : 's'} for ${result.routinesSuccess} routine${result.routinesSuccess === 1 ? '' : 's'}!`
        : "No new tasks needed"
      toast.success(message, { id: toastId })
      return true
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error"
      toast.error(`Failed to generate tasks: ${msg}`, { id: toastId })
      return false
    }
  }

  return {
    createRoutine,
    updateRoutine,
    deleteRoutine,
    deferRoutine,
    undeferRoutine,
    generateRoutineTasks,
  }
}
