import { NavHeader } from "./components/NavHeader"
import { SIDEBAR_CONFIG } from "./config/sidebarConfig"
import { SidebarHoverProvider, useSidebarHover } from "./contexts/SidebarHoverContext"
import { useSidebarData } from "./hooks/useSidebarData"
import { useSidebarState } from "./hooks/useSidebarState"
import { renderSection } from "./utils/renderSection"
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
    projectSort,
    setProjectSort,
    labelSort,
    setLabelSort,
    routineSort,
    setRoutineSort,
    collapsed,
    toggleSection,
    toggleProjectCollapse,
    isProjectCollapsed,
    togglePriorityGroupCollapse,
    isPriorityGroupCollapsed,
    // NEW: Unified section-scoped collapse
    toggleViewCollapse,
    isViewCollapsed,
  } = useSidebarState()

  const { setIsHovered } = useSidebarHover()

  // Use CountRegistry for all view counts (needed for NavHeader)
  const inboxCount = getCountForView("view:inbox", viewContext)
  const priorityQueueCount = getCountForView("view:multi:priority-queue", viewContext)
  const projectsCount = getCountForView("view:projects", viewContext)
  const routinesCount = getCountForView("view:routines", viewContext)

  const viewItems = buildViewItems(inboxCount, priorityQueueCount, projectsCount, routinesCount)

  // Create unified sort mode object for config-driven rendering
  const sortMode = {
    folders: projectSort,
    labels: labelSort,
    routines: routineSort,
  }

  // Create unified setSortMode function
  const setSortMode = (section: string, mode: string) => {
    if (section === "folders") {
      setProjectSort(mode as typeof projectSort)
    } else if (section === "labels") {
      setLabelSort(mode as typeof labelSort)
    } else if (section === "routines") {
      setRoutineSort(mode as typeof routineSort)
    }
  }

  // Common props for all sections
  const commonSectionProps = {
    currentViewKey,
    onViewChange,
    viewContext,
    collapsed,
    toggleSection,
    sortMode,
    setSortMode,
    getCountForView,
    isPriorityGroupCollapsed,
    togglePriorityGroupCollapse,
    isProjectCollapsed,
    toggleProjectCollapse,
    // NEW: Unified section-scoped collapse
    toggleViewCollapse,
    isViewCollapsed,
  }

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
            {SIDEBAR_CONFIG.sections.map((section) =>
              renderSection(section, commonSectionProps)
            )}
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
