/**
 * Helper to apply optimistic updates to entities
 *
 * Creates a new entity with optimistic changes applied,
 * used for filter re-evaluation to determine cursor movement.
 */

import type { OptimisticTaskUpdate } from "@/contexts/OptimisticUpdatesContext"
import type { TodoistTaskWithProject } from "@/types/convex/todoist"

/**
 * Apply optimistic update to task entity
 *
 * Returns new entity with optimistic changes applied.
 * Original entity is not mutated.
 *
 * @param task Original task entity
 * @param update Optimistic update to apply (or null)
 * @returns Task with optimistic changes applied
 */
export function applyOptimisticTaskUpdate(
  task: TodoistTaskWithProject,
  update: OptimisticTaskUpdate | null
): TodoistTaskWithProject {
  if (!update) return task

  // Create shallow copy to avoid mutating original
  const updated = { ...task }

  switch (update.type) {
    case "project-move":
      updated.project_id = update.newProjectId
      break

    case "priority-change":
      updated.priority = update.newPriority
      break

    case "label-change":
      updated.labels = update.newLabels
      break

    case "due-change":
      updated.due = update.newDue
      break

    case "deadline-change":
      updated.deadline = update.newDeadline
      break

    case "text-change":
      if (update.newContent !== undefined) {
        updated.content = update.newContent
      }
      if (update.newDescription !== undefined) {
        updated.description = update.newDescription
      }
      break

    case "task-complete":
      updated.checked = true
      break
  }

  return updated
}
