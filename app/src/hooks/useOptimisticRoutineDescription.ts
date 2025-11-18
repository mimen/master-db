import { createOptimisticRoutineHook } from "./createOptimisticHook"

import { api } from "@/convex/_generated/api"

/**
 * Centralized hook for routine description updates with optimistic updates
 *
 * - Adds routine to optimistic context immediately (description changes instantly)
 * - Calls updateRoutine mutation
 * - On failure: removes optimistic update to revert description
 * - On success: description stays updated (Convex syncs naturally)
 */
export const useOptimisticRoutineDescription = createOptimisticRoutineHook<[string], { routineId: string; description: string }, string>({
  mutationPath: api.routines.internalMutations.updateRoutine.updateRoutine,
  messages: {
    loading: "Updating routine description...",
    success: "Routine description updated!",
    error: "Failed to update routine description"
  },
  createUpdate: (routineId, newDescription) => ({
    routineId,
    type: "text-change",
    newDescription,
    timestamp: Date.now()
  }),
  createMutationArgs: (routineId, newDescription) => ({
    routineId,
    description: newDescription
  })
})
