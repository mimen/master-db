import type { PriorityFilterItem } from "../utils/filterItems"

import { SidebarButton } from "./SidebarButton"

import { SidebarMenuItem } from "@/components/ui/sidebar"
import { getPriorityColorClass } from "@/lib/priorities"
import { cn } from "@/lib/utils"
import type { ViewBuildContext, ViewKey, ViewSelection } from "@/lib/views/types"
import { resolveView } from "@/lib/views/viewDefinitions"

interface PriorityItemProps {
  priority: PriorityFilterItem
  currentViewKey: ViewKey
  onViewChange: (view: ViewSelection) => void
  viewContext: ViewBuildContext
  count: number
}

export function PriorityItem({
  priority,
  currentViewKey,
  onViewChange,
  viewContext,
  count,
}: PriorityItemProps) {
  const Icon = priority.icon
  const isActive = currentViewKey === priority.viewKey
  const colorClass = getPriorityColorClass(priority.priorityLevel)

  return (
    <SidebarMenuItem>
      <SidebarButton
        icon={<Icon className={cn(colorClass, "h-4 w-4 mr-3")} fill="currentColor" />}
        label={priority.label}
        count={count}
        isActive={isActive}
        onClick={() => onViewChange(resolveView(priority.viewKey, viewContext))}
      />
    </SidebarMenuItem>
  )
}
