import type { Doc } from "@/convex/_generated/dataModel"
import type { SortOption, GroupOption } from "@/lib/views/types"

// Use Convex Doc type for routines
type Routine = Doc<"routines">

/**
 * Helper to wrap sort functions with deferred-at-bottom behavior
 */
function withDeferredAtBottom(
  compareFn: (a: Routine, b: Routine) => number
) {
  return (a: Routine, b: Routine) => {
    // Always keep deferred (paused) routines at the bottom
    if (a.defer !== b.defer) {
      return a.defer ? 1 : -1
    }
    return compareFn(a, b)
  }
}

/**
 * Sort options for routines
 */
export const routineSortOptions: SortOption<Routine>[] = [
  {
    id: "default",
    label: "Default",
    // A-Z with deferred routines at the bottom
    compareFn: withDeferredAtBottom((a, b) => a.name.localeCompare(b.name)),
  },
  {
    id: "az",
    label: "A-Z",
    compareFn: (a, b) => a.name.localeCompare(b.name),
  },
  {
    id: "frequency",
    label: "Frequency",
    compareFn: (a, b) => {
      const frequencyOrder = [
        "Daily", "Twice a Week", "Weekly", "Every Other Week",
        "Monthly", "Every Other Month", "Quarterly",
        "Twice a Year", "Yearly", "Every Other Year"
      ]
      return frequencyOrder.indexOf(a.frequency) - frequencyOrder.indexOf(b.frequency)
    },
  },
  {
    id: "duration",
    label: "Duration",
    compareFn: (a, b) => {
      const durationOrder = ["5min", "15min", "30min", "45min", "1hr", "2hr", "3hr", "4hr"]
      return durationOrder.indexOf(a.duration) - durationOrder.indexOf(b.duration)
    },
  },
  {
    id: "created",
    label: "Recently Created",
    compareFn: (a, b) => b.createdAt - a.createdAt,
  },
]

/**
 * Group options for routines
 */
export const routineGroupOptions: GroupOption<Routine>[] = [
  {
    id: "duration",
    label: "Duration",
    groupFn: (routine) => routine.duration,
    getGroupLabel: (key) => {
      const labels: Record<string, string> = {
        "5min": "5 minutes",
        "15min": "15 minutes",
        "30min": "30 minutes",
        "45min": "45 minutes",
        "1hr": "1 hour",
        "2hr": "2 hours",
        "3hr": "3 hours",
        "4hr": "4 hours",
      }
      return labels[key] ?? key
    },
    groupSort: (a, b) => {
      const order = ["5min", "15min", "30min", "45min", "1hr", "2hr", "3hr", "4hr"]
      return order.indexOf(a) - order.indexOf(b)
    },
  },
  {
    id: "frequency",
    label: "Frequency",
    groupFn: (routine) => routine.frequency,
    getGroupLabel: (key) => key, // Frequency values are already human-readable
    groupSort: (a, b) => {
      const order = [
        "Daily", "Twice a Week", "Weekly", "Every Other Week",
        "Monthly", "Every Other Month", "Quarterly",
        "Twice a Year", "Yearly", "Every Other Year"
      ]
      return order.indexOf(a) - order.indexOf(b)
    },
  },
  {
    id: "project",
    label: "Project",
    groupFn: (routine) => routine.todoistProjectId ?? "unassigned",
    getGroupLabel: (projectId, groupData) => {
      if (projectId === "unassigned") {
        return "Unassigned"
      }
      const projects = groupData.projects as any[]
      const project = projects?.find((p) => p.todoist_id === projectId || p.id === projectId)
      // Note: If project not found, it's likely archived. Show a helpful message.
      return project?.name ?? `${projectId} (archived or deleted)`
    },
  },
]
