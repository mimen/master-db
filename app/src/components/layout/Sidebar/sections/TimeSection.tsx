import { ChevronRight } from "lucide-react"

import { SidebarButton } from "../components/SidebarButton"
import { TIME_FILTER_ITEMS } from "../utils/filterItems"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar"
import type { ViewBuildContext, ViewKey, ViewSelection } from "@/lib/views/types"
import { cn } from "@/lib/utils"
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
        <CollapsibleTrigger asChild>
          <SidebarGroupLabel className="cursor-pointer hover:bg-accent/50 flex items-center gap-1">
            <ChevronRight className={cn("h-3 w-3 transition-transform", !isCollapsed && "rotate-90")} />
            Time
          </SidebarGroupLabel>
        </CollapsibleTrigger>

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
