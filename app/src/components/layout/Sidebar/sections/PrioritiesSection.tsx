import { CollapseCaret } from "../components/CollapseCaret"
import { PriorityItem } from "../components/PriorityItem"
import { getPriorityProjectItems, PRIORITY_FILTER_ITEMS } from "../utils/filterItems"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { SidebarGroup, SidebarGroupLabel, SidebarMenu } from "@/components/ui/sidebar"
import type { ViewBuildContext, ViewKey, ViewSelection } from "@/lib/views/types"

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
              const count =
                counts?.priorityCounts.find((c) => c.priority === priority.priorityLevel)?.filteredTaskCount ||
                0

              return (
                <PriorityItem
                  key={priority.id}
                  priority={priority}
                  currentViewKey={currentViewKey}
                  onViewChange={onViewChange}
                  viewContext={viewContext}
                  count={count}
                />
              )
            })}
          </SidebarMenu>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}
