import type { WithAgent } from "@/lib/agent/agentOverlay"
import type { SortOption, GroupOption } from "@/lib/views/types"
import type { TodoistTaskWithProject } from "@/types/convex/todoist"

/**
 * Agent-mode sort options. The runtime entities in agent mode are
 * `WithAgent<TodoistTaskWithProject>` (decorated by `mergeAgentOverlay`), so
 * these compareFns read the `_agent` overlay off each task. Typed against the
 * undecorated task so they can sit beside `taskSortOptions` and be handed to
 * the same `BaseListView<TodoistTaskWithProject>`.
 *
 * Mirrors the server comparator in
 * `convex/agentic/queries/listAwaitingDecision.ts`: urgency numbers descending,
 * null/undefined (incl. tasks with no agent run) sorted last, ties broken by
 * `last_chatted_at` descending.
 */
export const agentSortOptions: SortOption<TodoistTaskWithProject>[] = [
  {
    id: "urgency",
    label: "Urgency",
    compareFn: (a, b) => {
      const aAgent = (a as WithAgent<TodoistTaskWithProject>)._agent
      const bAgent = (b as WithAgent<TodoistTaskWithProject>)._agent
      const aUrg = aAgent?.last_urgency
      const bUrg = bAgent?.last_urgency
      const aChatted = aAgent?.last_chatted_at ?? 0
      const bChatted = bAgent?.last_chatted_at ?? 0
      const aNull = aUrg == null
      const bNull = bUrg == null
      if (aNull && bNull) return bChatted - aChatted
      if (aNull) return 1
      if (bNull) return -1
      if (aUrg !== bUrg) return bUrg - aUrg
      return bChatted - aChatted
    },
  },
  {
    id: "last-chatted",
    label: "Last chatted",
    compareFn: (a, b) => {
      const aChatted = (a as WithAgent<TodoistTaskWithProject>)._agent?.last_chatted_at ?? 0
      const bChatted = (b as WithAgent<TodoistTaskWithProject>)._agent?.last_chatted_at ?? 0
      return bChatted - aChatted
    },
  },
]

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
      const project = projects?.find((p) => p.todoist_id === projectId || p.id === projectId)
      // Note: If project not found, it's likely archived. Show a helpful message.
      return project?.name ?? `${projectId} (archived or deleted)`
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
      const label = labels?.find((l) => l.id === labelId || l.todoist_id === labelId)
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
