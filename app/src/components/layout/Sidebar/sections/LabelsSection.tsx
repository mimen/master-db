import { ArrowDownAZ, Hash, Tag } from "lucide-react"

import { SidebarButton } from "../components/SidebarButton"
import { SortToggle } from "../components/SortToggle"
import type { LabelSort } from "../types"
import { getSortedLabels } from "../utils/sorting"

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
  counts?: { labelCounts: { labelId: string; filteredTaskCount: number }[] }
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
}: LabelsSectionProps) {
  const sortedLabels = getSortedLabels(labels, sortMode, counts)

  return (
    <div className="px-4 pb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-muted-foreground">Labels</h3>
        <SortToggle
          modes={LABEL_SORT_MODES}
          currentMode={sortMode}
          onToggle={onSortChange}
          getIcon={getLabelSortIcon}
        />
      </div>
      <div className="space-y-0.5 max-h-48 overflow-y-auto scrollbar-hide">
        {sortedLabels.map((label) => {
          const viewKey = `view:label:${label.name}` as ViewKey
          const isActive = currentViewKey === viewKey
          const count =
            counts?.labelCounts.find((c) => c.labelId === label.todoist_id)?.filteredTaskCount || 0

          return (
            <SidebarButton
              key={label._id}
              icon={
                <Tag className="h-4 w-4 mr-3" style={{ color: getProjectColor(label.color) }} />
              }
              label={`@${label.name}`}
              count={count}
              isActive={isActive}
              onClick={() => onViewChange(resolveView(viewKey, viewContext))}
            />
          )
        })}
        {(!sortedLabels || sortedLabels.length === 0) && (
          <p className="text-xs text-muted-foreground text-center py-4">No labels found</p>
        )}
      </div>
    </div>
  )
}
