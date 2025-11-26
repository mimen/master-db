import { createOptimisticProjectHook } from "./createOptimisticHook"

import { api } from "@/convex/_generated/api"
import type { ProjectType } from "@/lib/projectTypes"

/**
 * Centralized hook for project type updates with optimistic updates
 *
 * - Adds project to optimistic context immediately (type changes instantly)
 * - Calls updateProjectType API to update metadata task labels
 * - On failure: removes optimistic update to revert type
 * - On success: type stays updated (Convex syncs naturally)
 */
export const useOptimisticProjectType = createOptimisticProjectHook<[ProjectType | null]>({
  actionPath: api.todoist.actions.updateProjectType.updateProjectType,
  messages: {
    loading: "Updating project type...",
    success: "Project type updated!",
    error: "Failed to update project type"
  },
  createUpdate: (projectId, newType) => ({
    projectId,
    type: "project-type-change",
    newProjectType: newType,
    timestamp: Date.now()
  }),
  createActionArgs: (projectId, newType) => ({
    projectId,
    projectType: newType
  })
})
