import type { SortOption, GroupOption } from "@/lib/views/types"

// Routine type - matches Convex schema
export type Routine = {
  _id: string
  _creationTime: number
  name: string
  description?: string
  frequency: "Daily" | "Twice a Week" | "Weekly" | "Every Other Week" | "Monthly" | "Every Other Month" | "Quarterly" | "Twice a Year" | "Yearly" | "Every Other Year"
  duration: "5min" | "15min" | "30min" | "45min" | "1hr" | "2hr" | "3hr" | "4hr"
  timeOfDay?: "Morning" | "Day" | "Evening" | "Night"
  idealDay?: number
  todoistProjectId?: string
  todoistLabels: string[]
  priority: number // 1-4 (maps to Todoist P4-P1)
  defer: boolean
  deferralDate?: number
  lastCompletedDate?: number
  completionRateOverall: number | null
  completionRateMonth: number | null
  createdAt: number
  updatedAt: number
}

// Helper: Convert frequency to days for sorting
function frequencyToDays(frequency: Routine["frequency"]): number {
  const map: Record<Routine["frequency"], number> = {
    "Daily": 1,
    "Twice a Week": 3,
    "Weekly": 7,
    "Every Other Week": 14,
    "Monthly": 30,
    "Every Other Month": 60,
    "Quarterly": 90,
    "Twice a Year": 182,
    "Yearly": 365,
    "Every Other Year": 730,
  }
  return map[frequency]
}

// Helper: Convert duration to minutes for sorting
function durationToMinutes(duration: Routine["duration"]): number {
  const map: Record<Routine["duration"], number> = {
    "5min": 5,
    "15min": 15,
    "30min": 30,
    "45min": 45,
    "1hr": 60,
    "2hr": 120,
    "3hr": 180,
    "4hr": 240,
  }
  return map[duration]
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
    compareFn: (a, b) => frequencyToDays(a.frequency) - frequencyToDays(b.frequency),
  },
  {
    id: "duration",
    label: "Duration (Shortest First)",
    compareFn: (a, b) => durationToMinutes(a.duration) - durationToMinutes(b.duration),
  },
  {
    id: "priority",
    label: "Priority",
    compareFn: (a, b) => b.priority - a.priority, // Higher priority first (4 = P1, 1 = P4)
  },
  {
    id: "completion",
    label: "Completion Rate",
    compareFn: (a, b) => {
      // Sort by overall completion rate, treating null as -1 to sort last
      const aRate = a.completionRateOverall ?? -1
      const bRate = b.completionRateOverall ?? -1
      return bRate - aRate // Higher completion rate first
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
    id: "status",
    label: "Status",
    groupFn: (routine) => (routine.defer ? "paused" : "active"),
    getGroupLabel: (key) => {
      const labels: Record<string, string> = {
        active: "Active",
        paused: "Paused",
      }
      return labels[key] ?? "Unknown"
    },
    groupSort: (a, b) => {
      const order = ["active", "paused"]
      return order.indexOf(a) - order.indexOf(b)
    },
  },
  {
    id: "duration",
    label: "Duration",
    groupFn: (routine) => {
      const mins = durationToMinutes(routine.duration)
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
    groupFn: (routine) => routine.frequency,
    getGroupLabel: (key) => key, // Use the frequency value as-is (already human-readable)
    groupSort: (a, b) => {
      // Sort by frequency (most frequent first)
      const order: Routine["frequency"][] = [
        "Daily",
        "Twice a Week",
        "Weekly",
        "Every Other Week",
        "Monthly",
        "Every Other Month",
        "Quarterly",
        "Twice a Year",
        "Yearly",
        "Every Other Year",
      ]
      return order.indexOf(a as Routine["frequency"]) - order.indexOf(b as Routine["frequency"])
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
      const projects = groupData.projects as Array<{ todoist_id: string; id?: string; name: string }>
      const project = projects?.find((p) => p.todoist_id === projectId || p.id === projectId)
      // Note: If project not found, it's likely archived. Show a helpful message.
      return project?.name ?? `${projectId} (archived or deleted)`
    },
  },
]
