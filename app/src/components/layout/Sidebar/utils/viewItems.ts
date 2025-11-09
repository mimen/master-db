import { Calendar, Filter, Inbox } from "lucide-react"

import type { ViewNavItem } from "../types"

/**
 * Builds the static view navigation items with dynamic counts
 */
export function buildViewItems(inboxCount: number | null): ViewNavItem[] {
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
      count: null,
    },
  ]
}
