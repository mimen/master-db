import { NavHeader } from "./components/NavHeader"
import { useSidebarData } from "./hooks/useSidebarData"
import { useSidebarState } from "./hooks/useSidebarState"
import { LabelsSection } from "./sections/LabelsSection"
import { PrioritiesSection } from "./sections/PrioritiesSection"
import { ProjectsSection } from "./sections/ProjectsSection"
import { TimeSection } from "./sections/TimeSection"
import { ViewsSection } from "./sections/ViewsSection"
import { buildViewItems } from "./utils/viewItems"

import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sidebar as SidebarPrimitive,
  SidebarContent,
  SidebarHeader,
} from "@/components/ui/sidebar"
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
    collapsed,
    toggleSection,
  } = useSidebarState()

  const viewItems = buildViewItems(inboxProject?.stats.activeCount || null)

  return (
    <SidebarPrimitive>
      <SidebarHeader>
        <NavHeader
          onViewChange={onViewChange}
          projects={projectTree}
          labels={labels}
          viewContext={viewContext}
          viewItems={viewItems}
        />
      </SidebarHeader>
      <SidebarContent className="p-0 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-2 min-w-0 w-[265px]">
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
              isCollapsed={collapsed.projects}
              onToggleCollapse={() => toggleSection("projects")}
            />

            <TimeSection
              currentViewKey={currentViewKey}
              onViewChange={onViewChange}
              viewContext={viewContext}
              counts={timeFilterCounts}
              isCollapsed={collapsed.time}
              onToggleCollapse={() => toggleSection("time")}
            />

            <PrioritiesSection
              currentViewKey={currentViewKey}
              onViewChange={onViewChange}
              viewContext={viewContext}
              mode={priorityMode}
              onModeChange={setPriorityMode}
              counts={priorityFilterCounts}
              isCollapsed={collapsed.priorities}
              onToggleCollapse={() => toggleSection("priorities")}
            />

            <LabelsSection
              labels={labels}
              currentViewKey={currentViewKey}
              onViewChange={onViewChange}
              viewContext={viewContext}
              sortMode={labelSort}
              onSortChange={cycleLabelSort}
              counts={labelFilterCounts}
              isCollapsed={collapsed.labels}
              onToggleCollapse={() => toggleSection("labels")}
            />
          </div>
        </ScrollArea>
      </SidebarContent>
    </SidebarPrimitive>
  )
}
