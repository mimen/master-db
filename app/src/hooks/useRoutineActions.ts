import { useMutation } from "convex/react"
import { toast } from "sonner"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"

/**
 * Hook providing all routine CRUD operations with toast notifications
 */
export function useRoutineActions() {
  const createRoutineMutation = useMutation(api.routines.publicMutations.createRoutine)
  const updateRoutineMutation = useMutation(api.routines.publicMutations.updateRoutine)
  const deleteRoutineMutation = useMutation(api.routines.publicMutations.deleteRoutine)
  const deferRoutineMutation = useMutation(api.routines.publicMutations.deferRoutine)
  const undeferRoutineMutation = useMutation(api.routines.publicMutations.undeferRoutine)

  const createRoutine = async (args: {
    name: string
    description?: string
    frequency: string
    duration?: string
    category?: string
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
    category?: string
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

  return {
    createRoutine,
    updateRoutine,
    deleteRoutine,
    deferRoutine,
    undeferRoutine,
  }
}
