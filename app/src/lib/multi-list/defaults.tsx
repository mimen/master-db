import { getViewIcon } from "../icons/viewIcons"

import type { MultiListConfig } from "@/types/multi-list"

/**
 * Built-in multi-list configurations
 *
 * These are the default multi-lists available to all users.
 * They can be overridden by user-defined configurations.
 */
export const BUILT_IN_MULTI_LISTS: MultiListConfig[] = [
  {
    id: "daily-planning",
    name: "Daily Planning",
    icon: getViewIcon("view:multi:daily-planning", { size: "sm" }),
    isBuiltIn: true,
    description: "See all available work and schedule your day",
    estimatedMinutes: 45,
    sequence: [
      {
        view: "routine-tasks:morning",
      },
      {
        view: "routine-tasks:overdue",
      },
      {
        view: "inbox",
        maxTasks: 10,
      },
      {
        view: "priority:p1",
      },
      {
        view: "priority-projects:p1",
      },
      {
        view: "priority:p2",
      },
      {
        view: "priority-projects:p2",
      },
      {
        view: "label:errand",
      },
      {
        view: "label:convo",
      },
      {
        view: "routine-tasks:get-ahead",
      },
    ],
  },
  {
    id: "daily-execution",
    name: "Daily Execution",
    icon: getViewIcon("view:multi:daily-execution", { size: "sm" }),
    isBuiltIn: true,
    description: "Work through everything scheduled for today",
    estimatedMinutes: 180,
    sequence: [
      {
        view: "time:overdue",
      },
      {
        view: "today",
      },
      {
        view: "routine-tasks:todays",
      },
      {
        view: "label:quick",
      },
      {
        view: "label:needs followup",
      },
      {
        view: "routine-tasks:night",
      },
    ],
  },
  {
    id: "morning-review",
    name: "Morning Review",
    icon: getViewIcon("view:multi:morning-review", { size: "sm" }),
    isBuiltIn: true,
    description: "Quick morning review workflow",
    estimatedMinutes: 15,
    sequence: [
      {
        view: "time:overdue",
      },
      {
        view: "today",
      },
      {
        view: "inbox",
        maxTasks: 5,
      },
    ],
  },
  {
    id: "weekly-planning",
    name: "Weekly Planning",
    icon: getViewIcon("view:multi:weekly-planning", { size: "sm" }),
    isBuiltIn: true,
    description: "Weekly planning and review session",
    estimatedMinutes: 30,
    sequence: [
      {
        view: "time:overdue",
      },
      {
        view: "upcoming",
      },
      {
        view: "priority-projects:p1",
      },
      {
        view: "priority-projects:p2",
      },
      {
        view: "time:no-date",
        maxTasks: 10,
      },
    ],
  },
]

/**
 * Get a built-in multi-list by ID
 */
export function getBuiltInMultiList(id: string): MultiListConfig | undefined {
  return BUILT_IN_MULTI_LISTS.find((list) => list.id === id)
}

/**
 * Get all built-in multi-list IDs
 */
export function getBuiltInMultiListIds(): string[] {
  return BUILT_IN_MULTI_LISTS.map((list) => list.id)
}
