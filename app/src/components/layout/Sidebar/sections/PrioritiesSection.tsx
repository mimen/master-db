import { CollapseCaret } from "../components/CollapseCaret"
import { PriorityItem } from "../components/PriorityItem"
import { PRIORITY_FILTER_ITEMS } from "../utils/filterItems"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { SidebarGroup, SidebarGroupLabel, SidebarMenu } from "@/components/ui/sidebar"
import { useCountRegistry } from "@/contexts/CountContext"
import type { ViewBuildContext, ViewKey, ViewSelection } from "@/lib/views/types"

interface PrioritiesSectionProps {
  currentViewKey: ViewKey
  onViewChange: (view: ViewSelection) => void
  viewContext: ViewBuildContext
  isCollapsed: boolean
  onToggleCollapse: () => void
}

export function PrioritiesSection({
  currentViewKey,
  onViewChange,
  viewContext,
  isCollapsed,
  onToggleCollapse,
}: PrioritiesSectionProps) {
  const { getCountForView } = useCountRegistry()
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
          <SidebarMenu>
            {PRIORITY_FILTER_ITEMS.map((priority) => {
              const count = getCountForView(priority.viewKey, viewContext)

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
