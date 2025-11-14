import { createOptimisticProjectHook } from "./createOptimisticHook"

import { api } from "@/convex/_generated/api"

/**
 * Centralized hook for project name updates with optimistic updates
 *
 * - Adds project to optimistic context immediately (name changes instantly)
 * - Calls updateProjectName API
 * - On failure: removes optimistic update to revert name
 * - On success: name stays updated (Convex syncs naturally)
 */
export const useOptimisticProjectName = createOptimisticProjectHook<[string]>({
  actionPath: api.todoist.publicActions.updateProjectName,
  messages: {
    loading: "Updating project name...",
    success: "Project name updated!",
    error: "Failed to update project name"
  },
  createUpdate: (projectId, newName) => ({
    projectId,
    type: "text-change",
    newName,
    timestamp: Date.now()
  }),
  createActionArgs: (projectId, newName) => ({
    projectId,
    name: newName
  })
})
