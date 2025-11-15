import { createOptimisticProjectHook } from "./createOptimisticHook"

import { api } from "@/convex/_generated/api"

/**
 * Centralized hook for project hierarchy moves with optimistic updates
 *
 * Handles drag-and-drop hierarchy changes:
 * - Adds optimistic update to context immediately (instant UI feedback)
 * - Calls moveProject API to update parent_id and child_order
 * - On failure: removes optimistic update (rollback to original hierarchy)
 * - On success: hierarchy stays updated (Convex syncs naturally)
 */
export const useOptimisticProjectHierarchy = createOptimisticProjectHook<
  [string | null, number]
>({
  actionPath: api.todoist.publicActions.moveProject,
  messages: {
    loading: "Moving project...",
    success: "Project moved!",
    error: "Failed to move project",
  },
  createUpdate: (projectId, newParentId, newChildOrder) => ({
    projectId,
    type: "hierarchy-move",
    newParentId,
    newChildOrder,
    timestamp: Date.now(),
  }),
  createActionArgs: (projectId, newParentId, newChildOrder) => ({
    projectId,
    parentId: newParentId,
    childOrder: newChildOrder,
  }),
})
