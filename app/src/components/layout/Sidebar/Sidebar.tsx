import { NavHeader } from "./components/NavHeader"
import { SidebarHoverProvider, useSidebarHover } from "./contexts/SidebarHoverContext"
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
import { useCountRegistry } from "@/contexts/CountContext"
import type { ViewKey, ViewSelection } from "@/lib/views/types"

interface SidebarProps {
  currentViewKey: ViewKey
  onViewChange: (view: ViewSelection) => void
}

function SidebarContent_({ currentViewKey, onViewChange }: SidebarProps) {
  const {
    projectTree,
    labels,
    viewContext,
  } = useSidebarData()

  const { getCountForView } = useCountRegistry()

  const {
    expandNested,
    projectSort,
    setProjectSort,
    labelSort,
    setLabelSort,
    collapsed,
    toggleSection,
    toggleProjectCollapse,
    isProjectCollapsed,
    togglePriorityGroupCollapse,
    isPriorityGroupCollapsed,
  } = useSidebarState()

  const { setIsHovered } = useSidebarHover()

  // Use CountRegistry for all view counts
  const inboxCount = getCountForView("view:inbox", viewContext)
  const priorityQueueCount = getCountForView("view:multi:priority-queue", viewContext)
  const projectsCount = getCountForView("view:projects", viewContext)
  const routinesCount = getCountForView("view:routines", viewContext)

  const viewItems = buildViewItems(inboxCount, priorityQueueCount, projectsCount, routinesCount)

  return (
    <SidebarPrimitive
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
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
        <ScrollArea className="h-full mr-0.5">
          <div className="p-2 min-w-0 w-[265px]">
            <ViewsSection
              items={viewItems}
              currentViewKey={currentViewKey}
              onViewChange={onViewChange}
              viewContext={viewContext}
            />

            <TimeSection
              currentViewKey={currentViewKey}
              onViewChange={onViewChange}
              viewContext={viewContext}
              isCollapsed={collapsed.time}
              onToggleCollapse={() => toggleSection("time")}
            />

            <ProjectsSection
              projects={projectTree}
              currentViewKey={currentViewKey}
              onViewChange={onViewChange}
              viewContext={viewContext}
              expandNested={expandNested}
              sortMode={projectSort}
              onSortChange={setProjectSort}
              isCollapsed={collapsed.projects}
              onToggleCollapse={() => toggleSection("projects")}
              toggleProjectCollapse={toggleProjectCollapse}
              isProjectCollapsed={isProjectCollapsed}
              togglePriorityGroupCollapse={togglePriorityGroupCollapse}
              isPriorityGroupCollapsed={isPriorityGroupCollapsed}
            />

            <PrioritiesSection
              currentViewKey={currentViewKey}
              onViewChange={onViewChange}
              viewContext={viewContext}
              isCollapsed={collapsed.priorities}
              onToggleCollapse={() => toggleSection("priorities")}
            />

            <LabelsSection
              labels={labels}
              currentViewKey={currentViewKey}
              onViewChange={onViewChange}
              viewContext={viewContext}
              sortMode={labelSort}
              onSortChange={setLabelSort}
              isCollapsed={collapsed.labels}
              onToggleCollapse={() => toggleSection("labels")}
            />
          </div>
        </ScrollArea>
      </SidebarContent>
    </SidebarPrimitive>
  )
}

export function Sidebar(props: SidebarProps) {
  return (
    <SidebarHoverProvider>
      <SidebarContent_ {...props} />
    </SidebarHoverProvider>
  )
}
