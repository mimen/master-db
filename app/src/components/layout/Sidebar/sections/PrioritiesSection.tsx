import { ChevronRight } from "lucide-react"

import { SidebarButton } from "../components/SidebarButton"
import { getPriorityProjectItems, PRIORITY_FILTER_ITEMS } from "../utils/filterItems"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar"
import { getPriorityColorClass } from "@/lib/priorities"
import { cn } from "@/lib/utils"
import type { ViewBuildContext, ViewKey, ViewSelection } from "@/lib/views/types"
import { resolveView } from "@/lib/views/viewDefinitions"

interface PrioritiesSectionProps {
  currentViewKey: ViewKey
  onViewChange: (view: ViewSelection) => void
  viewContext: ViewBuildContext
  mode: "tasks" | "projects"
  onModeChange: (mode: "tasks" | "projects") => void
  counts?: { priorityCounts: { priority: number; filteredTaskCount: number }[] }
  isCollapsed: boolean
  onToggleCollapse: () => void
}

export function PrioritiesSection({
  currentViewKey,
  onViewChange,
  viewContext,
  mode,
  onModeChange,
  counts,
  isCollapsed,
  onToggleCollapse,
}: PrioritiesSectionProps) {
  return (
    <Collapsible open={!isCollapsed} onOpenChange={onToggleCollapse}>
      <SidebarGroup>
        <CollapsibleTrigger asChild>
          <SidebarGroupLabel className="cursor-pointer hover:bg-accent/50 flex items-center gap-1">
            <ChevronRight className={cn("h-3 w-3 transition-transform", !isCollapsed && "rotate-90")} />
            Priorities
          </SidebarGroupLabel>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="mb-3 flex items-center gap-2 px-3">
            <input
              type="checkbox"
              id="priority-mode"
              checked={mode === "projects"}
              onChange={(e) => onModeChange(e.target.checked ? "projects" : "tasks")}
              className="h-3.5 w-3.5 rounded border-gray-300"
            />
            <label htmlFor="priority-mode" className="text-xs text-muted-foreground cursor-pointer">
              Show as projects
            </label>
          </div>

          <SidebarMenu>
            {(mode === "projects" ? getPriorityProjectItems() : PRIORITY_FILTER_ITEMS).map((priority) => {
              const Icon = priority.icon
              const isActive = currentViewKey === priority.viewKey
              const count =
                counts?.priorityCounts.find((c) => c.priority === priority.priorityLevel)?.filteredTaskCount ||
                0
              const colorClass = getPriorityColorClass(priority.priorityLevel)

              return (
                <SidebarMenuItem key={priority.id}>
                  <SidebarButton
                    icon={<Icon className={cn(colorClass, "h-4 w-4 mr-3")} fill="currentColor" />}
                    label={priority.label}
                    count={count}
                    isActive={isActive}
                    onClick={() => onViewChange(resolveView(priority.viewKey, viewContext))}
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
