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
    id: "priority-queue",
    name: "Priority Queue",
    icon: getViewIcon("view:multi:priority-queue", { size: "sm" }),
    isBuiltIn: true,
    description: "Optimal task processing order: urgent → important → batched work",
    estimatedMinutes: 120,
    sequence: [
      {
        view: "time:overdue",
      },
      {
        view: "today",
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
        view: "priority-projects:p2",
      },
      {
        view: "upcoming",
        maxTasks: 15,
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
