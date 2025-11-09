import { ArrowDownAZ, ChevronRight, Hash, Tag } from "lucide-react"

import { SidebarButton } from "../components/SidebarButton"
import { SortToggle } from "../components/SortToggle"
import type { LabelSort } from "../types"
import { getSortedLabels } from "../utils/sorting"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar"
import { getProjectColor } from "@/lib/colors"
import { cn } from "@/lib/utils"
import type { ViewBuildContext, ViewKey, ViewSelection } from "@/lib/views/types"
import { resolveView } from "@/lib/views/viewDefinitions"
import type { TodoistLabelDoc } from "@/types/convex/todoist"

interface LabelsSectionProps {
  labels: TodoistLabelDoc[] | undefined
  currentViewKey: ViewKey
  onViewChange: (view: ViewSelection) => void
  viewContext: ViewBuildContext
  sortMode: LabelSort
  onSortChange: (mode: LabelSort) => void
  counts?: { labelCounts: { labelId: string; filteredTaskCount: number }[] }
  isCollapsed: boolean
  onToggleCollapse: () => void
}

const LABEL_SORT_MODES: readonly LabelSort[] = ["taskCount", "alphabetical"]

function getLabelSortIcon(mode: LabelSort) {
  switch (mode) {
    case "taskCount":
      return Hash
    case "alphabetical":
      return ArrowDownAZ
  }
}

export function LabelsSection({
  labels,
  currentViewKey,
  onViewChange,
  viewContext,
  sortMode,
  onSortChange,
  counts,
  isCollapsed,
  onToggleCollapse,
}: LabelsSectionProps) {
  const sortedLabels = getSortedLabels(labels, sortMode, counts)

  return (
    <Collapsible open={!isCollapsed} onOpenChange={onToggleCollapse}>
      <SidebarGroup>
        <div className="flex items-center justify-between">
          <CollapsibleTrigger asChild>
            <SidebarGroupLabel className="cursor-pointer hover:bg-accent/50 flex items-center gap-1">
              <ChevronRight className={cn("h-3 w-3 transition-transform", !isCollapsed && "rotate-90")} />
              Labels
            </SidebarGroupLabel>
          </CollapsibleTrigger>
          <div className="pr-2">
            <SortToggle
              modes={LABEL_SORT_MODES}
              currentMode={sortMode}
              onToggle={onSortChange}
              getIcon={getLabelSortIcon}
            />
          </div>
        </div>

        <CollapsibleContent>
          <SidebarMenu className="space-y-0.5">
            {sortedLabels.map((label) => {
                const viewKey = `view:label:${label.name}` as ViewKey
                const isActive = currentViewKey === viewKey
                const count =
                  counts?.labelCounts.find((c) => c.labelId === label.todoist_id)?.filteredTaskCount || 0

                return (
                  <SidebarMenuItem key={label._id}>
                    <SidebarButton
                      icon={<Tag className="h-4 w-4 mr-3" style={{ color: getProjectColor(label.color) }} />}
                      label={`@${label.name}`}
                      count={count}
                      isActive={isActive}
                      onClick={() => onViewChange(resolveView(viewKey, viewContext))}
                    />
                  </SidebarMenuItem>
                )
            })}
            {(!sortedLabels || sortedLabels.length === 0) && (
              <p className="text-xs text-muted-foreground text-center py-4">No labels found</p>
            )}
          </SidebarMenu>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}
