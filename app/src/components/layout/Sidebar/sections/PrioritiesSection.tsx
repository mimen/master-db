import { CollapseCaret } from "../components/CollapseCaret"
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
        <div className="flex items-center justify-between">
          <SidebarGroupLabel className="flex-1">Priorities</SidebarGroupLabel>
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
