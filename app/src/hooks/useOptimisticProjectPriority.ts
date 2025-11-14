import { api } from "@/convex/_generated/api"

import { createOptimisticProjectHook } from "./createOptimisticHook"

/**
 * Centralized hook for project priority updates with optimistic updates
 *
 * - Adds project to optimistic context immediately (priority changes instantly)
 * - Calls updateProjectMetadataPriority API
 * - On failure: removes optimistic update to revert priority
 * - On success: priority stays updated (Convex syncs naturally)
 */
export const useOptimisticProjectPriority = createOptimisticProjectHook<[number]>({
  actionPath: api.todoist.publicActions.updateProjectMetadataPriority,
  messages: {
    loading: "Updating project priority...",
    success: "Project priority updated!",
    error: "Failed to update project priority"
  },
  createUpdate: (projectId, newPriority) => ({
    projectId,
    newPriority,
    timestamp: Date.now()
  }),
  createActionArgs: (projectId, newPriority) => ({
    projectId,
    priority: newPriority
  })
})
