import { useSidebarData } from "./hooks/useSidebarData"
import { useSidebarState } from "./hooks/useSidebarState"
import { LabelsSection } from "./sections/LabelsSection"
import { PrioritiesSection } from "./sections/PrioritiesSection"
import { ProjectsSection } from "./sections/ProjectsSection"
import { TimeSection } from "./sections/TimeSection"
import { ViewsSection } from "./sections/ViewsSection"
import { buildViewItems } from "./utils/viewItems"

import type { ViewKey, ViewSelection } from "@/lib/views/types"

interface SidebarProps {
  currentViewKey: ViewKey
  onViewChange: (view: ViewSelection) => void
}

export function Sidebar({ currentViewKey, onViewChange }: SidebarProps) {
  const {
    projectTree,
    labels,
    timeFilterCounts,
    priorityFilterCounts,
    labelFilterCounts,
    inboxProject,
    viewContext,
  } = useSidebarData()

  const {
    expandNested,
    setExpandNested,
    priorityMode,
    setPriorityMode,
    projectSort,
    cycleProjectSort,
    labelSort,
    cycleLabelSort,
  } = useSidebarState()

  const viewItems = buildViewItems(inboxProject?.stats.activeCount || null)

  return (
    <div className="w-72 bg-muted/30 border-r h-full flex flex-col">
      <ViewsSection
        items={viewItems}
        currentViewKey={currentViewKey}
        onViewChange={onViewChange}
        viewContext={viewContext}
      />

      <ProjectsSection
        projects={projectTree}
        currentViewKey={currentViewKey}
        onViewChange={onViewChange}
        viewContext={viewContext}
        expandNested={expandNested}
        onExpandNestedChange={setExpandNested}
        sortMode={projectSort}
        onSortChange={cycleProjectSort}
      />

      <TimeSection
        currentViewKey={currentViewKey}
        onViewChange={onViewChange}
        viewContext={viewContext}
        counts={timeFilterCounts}
      />

      <PrioritiesSection
        currentViewKey={currentViewKey}
        onViewChange={onViewChange}
        viewContext={viewContext}
        mode={priorityMode}
        onModeChange={setPriorityMode}
        counts={priorityFilterCounts}
      />

      <LabelsSection
        labels={labels}
        currentViewKey={currentViewKey}
        onViewChange={onViewChange}
        viewContext={viewContext}
        sortMode={labelSort}
        onSortChange={cycleLabelSort}
        counts={labelFilterCounts}
      />
    </div>
  )
}
