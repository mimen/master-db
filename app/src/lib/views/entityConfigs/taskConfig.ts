import type { SortOption, GroupOption, GroupData } from "@/lib/views/types"
import type { TodoistTaskWithProject } from "@/types/convex/todoist"

/**
 * Sort options for tasks
 */
export const taskSortOptions: SortOption<TodoistTaskWithProject>[] = [
  {
    id: "az",
    label: "A-Z",
    compareFn: (a, b) => a.content.localeCompare(b.content),
  },
  {
    id: "priority",
    label: "Priority",
    compareFn: (a, b) => {
      // Invert: higher API number = higher UI priority
      // API 4 = P1 (highest), API 1 = P4 (lowest)
      const aPriority = a.priority ?? 1
      const bPriority = b.priority ?? 1
      return bPriority - aPriority
    },
  },
  {
    id: "due-date",
    label: "Due Date",
    compareFn: (a, b) => {
      // No due date goes to end
      if (!a.due?.date && !b.due?.date) return 0
      if (!a.due?.date) return 1
      if (!b.due?.date) return -1
      // Earlier dates first
      return a.due.date.localeCompare(b.due.date)
    },
  },
]

/**
 * Group options for tasks
 */
export const taskGroupOptions: GroupOption<TodoistTaskWithProject>[] = [
  {
    id: "project",
    label: "Project",
    groupFn: (task) => task.project_id ?? "inbox",
    getGroupLabel: (projectId, groupData) => {
      if (projectId === "inbox") {
        return "Inbox"
      }
      const projects = groupData.projects as any[]
      const project = projects?.find((p) => p.id === projectId)
      return project?.name ?? "Unknown Project"
    },
  },
  {
    id: "priority",
    label: "Priority",
    groupFn: (task) => task.priority?.toString() ?? "1",
    getGroupLabel: (priority) => {
      // Convert API priority to UI priority label
      // API 4 = P1 (highest), API 1 = P4 (lowest), null = P4
      const apiPriority = parseInt(priority, 10)
      if (apiPriority === 4) return "P1 (Highest)"
      if (apiPriority === 3) return "P2 (High)"
      if (apiPriority === 2) return "P3 (Medium)"
      return "P4 (Normal)"
    },
    groupSort: (a, b) => {
      // Sort by API priority descending (4, 3, 2, 1)
      return parseInt(b, 10) - parseInt(a, 10)
    },
  },
  {
    id: "label",
    label: "Label",
    groupFn: (task) => task.labels?.[0] ?? "no-label",
    getGroupLabel: (labelId, groupData) => {
      if (labelId === "no-label") {
        return "No Label"
      }
      const labels = groupData.labels as any[]
      const label = labels?.find((l) => l.id === labelId)
      return label?.name ?? "Unknown Label"
    },
  },
  {
    id: "due-status",
    label: "Due Status",
    groupFn: (task) => {
      if (!task.due?.date) return "no-due"

      const dueDate = new Date(task.due.date)
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      if (dueDate < today) return "overdue"
      if (dueDate.getTime() === today.getTime()) return "today"
      if (
        dueDate.getTime() ===
        new Date(today.getTime() + 86400000).getTime()
      )
        return "tomorrow"
      return "upcoming"
    },
    getGroupLabel: (status) => {
      const labels: Record<string, string> = {
        overdue: "Overdue",
        today: "Due Today",
        tomorrow: "Due Tomorrow",
        upcoming: "Due Later",
        "no-due": "No Due Date",
      }
      return labels[status] ?? "Unknown"
    },
    groupSort: (a, b) => {
      const order = ["overdue", "today", "tomorrow", "upcoming", "no-due"]
      return order.indexOf(a) - order.indexOf(b)
    },
  },
]
