import { createOptimisticRoutineHook } from "./createOptimisticHook"

import { api } from "@/convex/_generated/api"

/**
 * Optimistic hook for routine project changes
 *
 * Sets which project tasks from this routine will be created in
 */
export const useOptimisticRoutineProject = createOptimisticRoutineHook<[string | undefined]>({
  mutationPath: api.routines.internalMutations.updateRoutine.updateRoutine,
  messages: {
    loading: "Updating project...",
    success: "Project updated!",
    error: "Failed to update project"
  },
  createUpdate: (routineId, newProjectId) => ({
    routineId,
    type: "project-change",
    newProjectId,
    timestamp: Date.now()
  }),
  createMutationArgs: (routineId, newProjectId) => ({
    routineId,
    todoistProjectId: newProjectId
  })
})
