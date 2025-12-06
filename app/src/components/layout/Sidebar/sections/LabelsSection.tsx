import { ArrowDownAZ, Hash, Tag } from "lucide-react"
import { useMemo } from "react"

import { CollapseCaret } from "../components/CollapseCaret"
import { SidebarButton } from "../components/SidebarButton"
import { SortDropdown } from "../components/SortDropdown"
import type { LabelSort } from "../types"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar"
import { useCountRegistry } from "@/contexts/CountContext"
import { getProjectColor } from "@/lib/colors"
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
  isCollapsed,
  onToggleCollapse,
}: LabelsSectionProps) {
  const { getCountForView } = useCountRegistry()

  // Sort labels using CountRegistry
  const sortedLabels = useMemo(() => {
    if (!labels) return []

    const labelsWithCounts = labels.map((label) => ({
      label,
      count: getCountForView(`view:label:${label.name}` as ViewKey, viewContext),
    }))

    if (sortMode === "taskCount") {
      return labelsWithCounts
        .sort((a, b) => b.count - a.count)
        .map((item) => item.label)
    }

    // Alphabetical
    return labelsWithCounts
      .sort((a, b) => a.label.name.localeCompare(b.label.name))
      .map((item) => item.label)
  }, [labels, sortMode, getCountForView, viewContext])

  return (
    <Collapsible open={!isCollapsed} onOpenChange={onToggleCollapse}>
      <SidebarGroup>
        <div className="flex items-center justify-between">
          <SidebarGroupLabel className="flex-1">Labels</SidebarGroupLabel>
          <div className="flex items-center pr-2">
            <SortDropdown
              modes={LABEL_SORT_MODES}
              currentMode={sortMode}
              onChange={onSortChange}
              getIcon={getLabelSortIcon}
            />
            <CollapsibleTrigger asChild>
              <CollapseCaret
                isCollapsed={isCollapsed}
                onToggle={(e) => {
                  e.preventDefault()
                  onToggleCollapse()
                }}
              />
            </CollapsibleTrigger>
          </div>
        </div>

        <CollapsibleContent>
          <SidebarMenu className="space-y-0.5">
            {sortedLabels.map((label) => {
                const viewKey = `view:label:${label.name}` as ViewKey
                const isActive = currentViewKey === viewKey
                const count = getCountForView(viewKey, viewContext)

                return (
                  <SidebarMenuItem key={label._id}>
                    <SidebarButton
                      icon={<Tag className="h-4 w-4" style={{ color: getProjectColor(label.color) }} />}
                      label={`${label.name}`}
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
