import type { SortOption, GroupOption, GroupData } from "@/lib/views/types"

// Routine type - will use doc structure from Convex
export type Routine = {
  _id: string
  _creationTime: number
  name: string
  description?: string
  frequency?: "daily" | "weekly" | "biweekly" | "monthly"
  estimatedDuration?: number
  todoistProjectId?: string
  defer?: boolean
  createdAt: number
}

/**
 * Sort options for routines
 */
export const routineSortOptions: SortOption<Routine>[] = [
  {
    id: "az",
    label: "A-Z",
    compareFn: (a, b) => a.name.localeCompare(b.name),
  },
  {
    id: "frequency",
    label: "Frequency",
    compareFn: (a, b) => {
      const frequencyOrder = ["daily", "weekly", "biweekly", "monthly"]
      const aFreq = a.frequency ?? ""
      const bFreq = b.frequency ?? ""
      return frequencyOrder.indexOf(aFreq) - frequencyOrder.indexOf(bFreq)
    },
  },
  {
    id: "duration",
    label: "Duration",
    compareFn: (a, b) => (b.estimatedDuration ?? 0) - (a.estimatedDuration ?? 0),
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
    groupFn: (routine) => {
      const mins = routine.estimatedDuration ?? 0
      if (mins < 30) return "short"
      if (mins < 60) return "medium"
      return "long"
    },
    getGroupLabel: (key) => {
      const labels: Record<string, string> = {
        short: "< 30 minutes",
        medium: "30-60 minutes",
        long: "60+ minutes",
      }
      return labels[key] ?? "Unknown"
    },
    groupSort: (a, b) => {
      const order = ["short", "medium", "long"]
      return order.indexOf(a) - order.indexOf(b)
    },
  },
  {
    id: "frequency",
    label: "Frequency",
    groupFn: (routine) => routine.frequency ?? "custom",
    getGroupLabel: (key) => {
      const labels: Record<string, string> = {
        daily: "Daily",
        weekly: "Weekly",
        biweekly: "Bi-weekly",
        monthly: "Monthly",
        custom: "Custom",
      }
      return labels[key] ?? "Unknown"
    },
    groupSort: (a, b) => {
      const order = ["daily", "weekly", "biweekly", "monthly", "custom"]
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
