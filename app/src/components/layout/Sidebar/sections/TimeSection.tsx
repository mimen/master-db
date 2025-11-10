import { CollapseCaret } from "../components/CollapseCaret"
import { SidebarButton } from "../components/SidebarButton"
import { TIME_FILTER_ITEMS } from "../utils/filterItems"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar"
import type { ViewBuildContext, ViewKey, ViewSelection } from "@/lib/views/types"
import { resolveView } from "@/lib/views/viewDefinitions"

interface TimeSectionProps {
  currentViewKey: ViewKey
  onViewChange: (view: ViewSelection) => void
  viewContext: ViewBuildContext
  counts?: { timeCounts: { filter: string; filteredTaskCount: number }[] }
  isCollapsed: boolean
  onToggleCollapse: () => void
}

export function TimeSection({
  currentViewKey,
  onViewChange,
  viewContext,
  counts,
  isCollapsed,
  onToggleCollapse,
}: TimeSectionProps) {
  return (
    <Collapsible open={!isCollapsed} onOpenChange={onToggleCollapse}>
      <SidebarGroup>
        <div className="flex items-center justify-between">
          <SidebarGroupLabel className="flex-1">Time</SidebarGroupLabel>
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
            {TIME_FILTER_ITEMS.map((timeFilter) => {
              const isActive = currentViewKey === timeFilter.viewKey
              const count =
                counts?.timeCounts.find((c) => c.filter === timeFilter.filterKey)?.filteredTaskCount || 0

              return (
                <SidebarMenuItem key={timeFilter.id}>
                  <SidebarButton
                    icon={timeFilter.icon}
                    label={timeFilter.label}
                    count={count}
                    isActive={isActive}
                    onClick={() => onViewChange(resolveView(timeFilter.viewKey, viewContext))}
                    colorClass={timeFilter.color}
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
