import { Filter, Folder, Inbox, Repeat, Settings } from "lucide-react"

import type { ViewNavItem } from "../types"

/**
 * Builds the static view navigation items with dynamic counts
 */
export function buildViewItems(
  inboxCount: number,
  priorityQueueCount: number,
  projectsCount: number,
  routinesCount: number
): ViewNavItem[] {
  return [
    {
      key: "view:inbox",
      label: "Inbox",
      icon: Inbox,
      count: inboxCount,
    },
    {
      key: "view:multi:priority-queue",
      label: "Priority Queue",
      icon: Filter,
      count: priorityQueueCount,
    },
    {
      key: "view:folders",
      label: "Folders",
      icon: Folder,
      count: projectsCount,
    },
    {
      key: "view:routines",
      label: "Routines",
      icon: Repeat,
      count: routinesCount,
    },
    {
      key: "view:settings",
      label: "Settings",
      icon: Settings,
      count: null,
    },
  ]
}
