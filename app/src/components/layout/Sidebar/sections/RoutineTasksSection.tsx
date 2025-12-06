import { CollapseCaret } from "../components/CollapseCaret"
import { SidebarButton } from "../components/SidebarButton"
import { ROUTINE_TASK_FILTER_ITEMS } from "../utils/filterItems"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar"
import { useCountRegistry } from "@/contexts/CountContext"
import { getViewIcon } from "@/lib/icons/viewIcons"
import type { ViewBuildContext, ViewKey, ViewSelection } from "@/lib/views/types"
import { resolveView } from "@/lib/views/viewDefinitions"

interface RoutineTasksSectionProps {
  currentViewKey: ViewKey
  onViewChange: (view: ViewSelection) => void
  viewContext: ViewBuildContext
  isCollapsed: boolean
  onToggleCollapse: () => void
}

export function RoutineTasksSection({
  currentViewKey,
  onViewChange,
  viewContext,
  isCollapsed,
  onToggleCollapse,
}: RoutineTasksSectionProps) {
  const { getCountForView } = useCountRegistry()
  return (
    <Collapsible open={!isCollapsed} onOpenChange={onToggleCollapse}>
      <SidebarGroup>
        <div className="flex items-center justify-between">
          <SidebarGroupLabel className="flex-1">Routine Tasks</SidebarGroupLabel>
          <CollapsibleTrigger asChild>
            <div className="mr-2">
              <CollapseCaret
                isCollapsed={isCollapsed}
                onToggle={(e) => {
                  e.preventDefault()
                  onToggleCollapse()
                }}
              />
            </div>
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent>
          <SidebarMenu>
            {ROUTINE_TASK_FILTER_ITEMS.map((filter) => {
              const isActive = currentViewKey === filter.viewKey
              const count = getCountForView(filter.viewKey, viewContext)
              const icon = getViewIcon(filter.viewKey, { size: "sm" })

              return (
                <SidebarMenuItem key={filter.id}>
                  <SidebarButton
                    icon={icon}
                    label={filter.label}
                    count={count}
                    isActive={isActive}
                    onClick={() => onViewChange(resolveView(filter.viewKey, viewContext))}
                  />
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}
