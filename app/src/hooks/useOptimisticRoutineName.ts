import { createOptimisticRoutineHook } from "./createOptimisticHook"

import { api } from "@/convex/_generated/api"

/**
 * Centralized hook for routine name updates with optimistic updates
 *
 * - Adds routine to optimistic context immediately (name changes instantly)
 * - Calls updateRoutine mutation
 * - On failure: removes optimistic update to revert name
 * - On success: name stays updated (Convex syncs naturally)
 */
export const useOptimisticRoutineName = createOptimisticRoutineHook<[string], { routineId: string; name: string }, string>({
  mutationPath: api.routines.internalMutations.updateRoutine.updateRoutine,
  messages: {
    loading: "Updating routine name...",
    success: "Routine name updated!",
    error: "Failed to update routine name"
  },
  createUpdate: (routineId, newName) => ({
    routineId,
    type: "text-change",
    newName,
    timestamp: Date.now()
  }),
  createMutationArgs: (routineId, newName) => ({
    routineId,
    name: newName
  })
})
