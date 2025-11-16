import { createOptimisticProjectHook } from "./createOptimisticHook"

import { api } from "@/convex/_generated/api"

/**
 * Centralized hook for project description updates with optimistic updates
 *
 * - Adds project to optimistic context immediately (description changes instantly)
 * - Calls updateProjectMetadataDescription API
 * - On failure: removes optimistic update to revert description
 * - On success: description stays updated (Convex syncs naturally)
 */
export const useOptimisticProjectDescription = createOptimisticProjectHook<[string]>({
  actionPath: api.todoist.actions.updateProjectMetadataDescription.updateProjectMetadataDescription,
  messages: {
    loading: "Updating description...",
    success: "Description updated!",
    error: "Failed to update description"
  },
  createUpdate: (projectId, newDescription) => ({
    projectId,
    type: "text-change",
    newDescription,
    timestamp: Date.now()
  }),
  createActionArgs: (projectId, newDescription) => ({
    projectId,
    description: newDescription
  })
})
