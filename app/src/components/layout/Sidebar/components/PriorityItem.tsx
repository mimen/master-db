import type { SVGProps } from "react"
import type { MouseEvent } from "react"

import type { PriorityFilterItem } from "../utils/filterItems"

import { SidebarButton } from "./SidebarButton"

import { SidebarMenuItem } from "@/components/ui/sidebar"
import { getPriorityColorClass } from "@/lib/priorities"
import { cn } from "@/lib/utils"
import type { ViewBuildContext, ViewKey, ViewSelection } from "@/lib/views/types"
import { resolveView } from "@/lib/views/viewDefinitions"

interface PriorityItemProps {
  priority: PriorityFilterItem
  currentViewKey?: ViewKey
  onViewChange?: (view: ViewSelection) => void
  viewContext?: ViewBuildContext
  count: number
  // Collapsible mode props
  isCollapsible?: boolean
  isCollapsed?: boolean
  onToggle?: (e: MouseEvent) => void
}

export function PriorityItem({
  priority,
  currentViewKey,
  onViewChange,
  viewContext,
  count,
  isCollapsible = false,
  isCollapsed = false,
  onToggle,
}: PriorityItemProps) {
  const Icon = priority.icon
  const isActive = currentViewKey === priority.viewKey
  const colorClass = getPriorityColorClass(priority.priorityLevel)

  // Both collapsible and non-collapsible modes should navigate on click
  const handleClick = () => {
    if (onViewChange && viewContext) {
      onViewChange(resolveView(priority.viewKey, viewContext))
    }
  }

  const content = (
    <SidebarButton
      icon={
        <Icon
          className={cn(colorClass, "h-4 w-4 mr-3")}
          {...({ fill: "currentColor" } as SVGProps<SVGSVGElement>)}
        />
      }
      label={priority.label}
      count={count}
      isActive={isActive || false}
      onClick={handleClick}
      hasChildren={isCollapsible}
      isCollapsed={isCollapsed}
      onToggleCollapse={isCollapsible ? onToggle : undefined}
    />
  )

  // When used as a collapsible group header, don't wrap in li tag
  if (isCollapsible) {
    return <>{content}</>
  }

  // When used as a navigation item, wrap in li tag
  return <SidebarMenuItem>{content}</SidebarMenuItem>
}
