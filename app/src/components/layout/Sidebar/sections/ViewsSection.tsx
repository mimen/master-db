import { ArrowDownAZ, Hash, Network } from "lucide-react"
import { useMemo } from "react"

import { FolderTypeItem } from "../components/FolderTypeItem"
import { PriorityItem } from "../components/PriorityItem"
import { ProjectItem } from "../components/ProjectItem"
import { SidebarButton } from "../components/SidebarButton"
import { SortDropdown } from "../components/SortDropdown"
import type { RoutineSort, ViewNavItem } from "../types"
import { FOLDER_TYPE_ITEMS, PRIORITY_QUEUE_FILTER_ITEMS, PRIORITY_PROJECTS_ITEMS } from "../utils/filterItems"

import { RoutineProjectItem } from "./RoutineProjectItem"

import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import { SidebarGroup, SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar"
import { useCountRegistry } from "@/contexts/CountContext"
import { useDialogContext } from "@/contexts/DialogContext"
import { getViewIcon } from "@/lib/icons/viewIcons"
import type { ViewBuildContext, ViewKey, ViewSelection } from "@/lib/views/types"
import { resolveView } from "@/lib/views/viewDefinitions"

const ROUTINE_SORT_MODES: readonly RoutineSort[] = ["flat", "projectOrder", "routineCount"]

function getRoutineSortIcon(mode: RoutineSort) {
  switch (mode) {
    case "flat":
      return ArrowDownAZ
    case "projectOrder":
      return Network
    case "routineCount":
      return Hash
  }
}

interface ViewsSectionProps {
  items: ViewNavItem[]
  currentViewKey: ViewKey
  onViewChange: (view: ViewSelection) => void
  viewContext: ViewBuildContext
  isFoldersCollapsed: boolean
  onToggleFoldersCollapse: () => void
  isRoutinesCollapsed: boolean
  onToggleRoutinesCollapse: () => void
  routineSort: RoutineSort
  onRoutineSortChange: (sort: RoutineSort) => void
  isPriorityQueueCollapsed: boolean
  onTogglePriorityQueueCollapse: () => void
  isPriorityQueueGroupCollapsed: (priority: number) => boolean
  togglePriorityQueueGroupCollapse: (priority: number) => void
  toggleProjectCollapse: (projectId: string) => void
  isProjectCollapsed: (projectId: string) => boolean
}

export function ViewsSection({
  items,
  currentViewKey,
  onViewChange,
  viewContext,
  isFoldersCollapsed,
  onToggleFoldersCollapse,
  isRoutinesCollapsed,
  onToggleRoutinesCollapse,
  routineSort,
  onRoutineSortChange,
  isPriorityQueueCollapsed,
  onTogglePriorityQueueCollapse,
  isPriorityQueueGroupCollapsed,
  togglePriorityQueueGroupCollapse,
  toggleProjectCollapse,
  isProjectCollapsed,
}: ViewsSectionProps) {
  const { openSettings } = useDialogContext()
  const { getCountForView, registry } = useCountRegistry()

  // Filter and sort projects that have routines (active routine count > 0)
  const projectsWithRoutines = useMemo(() => {
    if (!viewContext.projectsWithMetadata) return []

    const allCounts = registry.getAllCounts()
    const filtered = viewContext.projectsWithMetadata.filter((project) => {
      const countKey = `list:routines:${project.todoist_id}`
      const count = allCounts[countKey] ?? 0
      return count > 0
    })

    // Sort based on sortMode
    switch (routineSort) {
      case "flat":
        return [...filtered].sort((a, b) => a.name.localeCompare(b.name))
      case "routineCount": {
        const projectsWithCounts = filtered.map((project) => {
          const countKey = `list:routines:${project.todoist_id}`
          const count = allCounts[countKey] ?? 0
          return { project, count }
        })
        return projectsWithCounts
          .sort((a, b) => b.count - a.count)
          .map((item) => item.project)
      }
      case "projectOrder":
        // For now, just alphabetical. Could implement hierarchy later
        return [...filtered].sort((a, b) => a.name.localeCompare(b.name))
      default:
        return filtered
    }
  }, [viewContext.projectsWithMetadata, registry, routineSort])

  return (
    <SidebarGroup>
      <SidebarMenu>
        {items.map((item) => {
          // Special handling for Folders - make it collapsible
          if (item.key === "view:folders") {
            const isActive = currentViewKey === item.key

            return (
              <Collapsible key={item.key} open={!isFoldersCollapsed} onOpenChange={onToggleFoldersCollapse}>
                <SidebarMenuItem>
                  <SidebarButton
                    icon={item.icon}
                    label={item.label}
                    count={item.count}
                    isActive={isActive}
                    onClick={() => {
                      // Clicking the button navigates to the folders view
                      onViewChange(resolveView(item.key, viewContext))
                    }}
                    hasChildren={true}
                    isCollapsed={isFoldersCollapsed}
                    onToggleCollapse={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      onToggleFoldersCollapse()
                    }}
                  />
                </SidebarMenuItem>

                <CollapsibleContent>
                  <SidebarMenu>
                    {FOLDER_TYPE_ITEMS.map((folderType) => {
                      const count = getCountForView(folderType.viewKey, viewContext)
                      return (
                        <FolderTypeItem
                          key={folderType.id}
                          folderType={folderType}
                          currentViewKey={currentViewKey}
                          onViewChange={onViewChange}
                          viewContext={viewContext}
                          count={count}
                        />
                      )
                    })}
                  </SidebarMenu>
                </CollapsibleContent>
              </Collapsible>
            )
          }

          // Special handling for Routines - make it collapsible
          if (item.key === "view:routines") {
            const isActive = currentViewKey === item.key || currentViewKey.startsWith("view:routines:project:")

            return (
              <Collapsible key={item.key} open={!isRoutinesCollapsed} onOpenChange={onToggleRoutinesCollapse}>
                <SidebarMenuItem>
                  <SidebarButton
                    icon={item.icon}
                    label={item.label}
                    count={item.count}
                    isActive={isActive}
                    onClick={() => {
                      // Clicking the button navigates to the routines view
                      onViewChange(resolveView(item.key, viewContext))
                    }}
                    hasChildren={true}
                    isCollapsed={isRoutinesCollapsed}
                    onToggleCollapse={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      onToggleRoutinesCollapse()
                    }}
                  >
                    {!isRoutinesCollapsed && (
                      <SortDropdown
                        modes={ROUTINE_SORT_MODES}
                        currentMode={routineSort}
                        onChange={onRoutineSortChange}
                        getIcon={getRoutineSortIcon}
                      />
                    )}
                  </SidebarButton>
                </SidebarMenuItem>

                <CollapsibleContent>
                  <SidebarMenu>
                    {projectsWithRoutines.map((project) => {
                      const countKey = `list:routines:${project.todoist_id}`
                      const count = registry.getAllCounts()[countKey] ?? 0

                      return (
                        <RoutineProjectItem
                          key={project._id}
                          project={project}
                          currentViewKey={currentViewKey}
                          onViewChange={onViewChange}
                          viewContext={viewContext}
                          count={count}
                        />
                      )
                    })}
                    {projectsWithRoutines.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-4">
                        No projects with routines yet
                      </p>
                    )}
                  </SidebarMenu>
                </CollapsibleContent>
              </Collapsible>
            )
          }

          // Special handling for Priority Queue - make it collapsible
          if (item.key === "view:multi:priority-queue") {
            const isActive =
              currentViewKey === item.key ||
              PRIORITY_QUEUE_FILTER_ITEMS.some((pqItem) => currentViewKey === pqItem.viewKey)

            return (
              <Collapsible
                key={item.key}
                open={!isPriorityQueueCollapsed}
                onOpenChange={onTogglePriorityQueueCollapse}
              >
                <SidebarMenuItem>
                  <SidebarButton
                    icon={item.icon}
                    label={item.label}
                    count={item.count}
                    isActive={isActive}
                    onClick={() => onViewChange(resolveView(item.key, viewContext))}
                    hasChildren={true}
                    isCollapsed={isPriorityQueueCollapsed}
                    onToggleCollapse={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      onTogglePriorityQueueCollapse()
                    }}
                  />
                </SidebarMenuItem>

                <CollapsibleContent>
                  <SidebarMenu>
                    {PRIORITY_QUEUE_FILTER_ITEMS.map((pqItem) => {
                      const isItemActive = currentViewKey === pqItem.viewKey
                      const count = getCountForView(pqItem.viewKey, viewContext)
                      const icon = getViewIcon(pqItem.viewKey, { size: "sm" })

                      // Check if this is a priority-projects item (P1 or P2 Projects)
                      const isPriorityProjects = pqItem.viewKey.startsWith("view:priority-projects:")

                      if (isPriorityProjects) {
                        // Get priority level from viewKey
                        const priorityId = pqItem.viewKey.replace("view:priority-projects:", "") as "p1" | "p2"
                        const priorityLevel = priorityId === "p1" ? 4 : 3

                        // Find matching priority item for proper rendering
                        const priorityItem = PRIORITY_PROJECTS_ITEMS.find((p) => p.priorityLevel === priorityLevel)
                        if (!priorityItem) return null

                        // Get projects with this priority level
                        const projectsWithPriority = (viewContext.projectsWithMetadata || []).filter(
                          (project) => (project.metadata?.priority || 1) === priorityLevel
                        )

                        const isGroupCollapsed = isPriorityQueueGroupCollapsed(priorityLevel)

                        return (
                          <div key={pqItem.id} className="pl-4">
                            <PriorityItem
                              priority={priorityItem}
                              currentViewKey={currentViewKey}
                              onViewChange={onViewChange}
                              viewContext={viewContext}
                              count={count}
                              isCollapsible={true}
                              isCollapsed={isGroupCollapsed}
                              onToggle={(e) => {
                                e.stopPropagation()
                                togglePriorityQueueGroupCollapse(priorityLevel)
                              }}
                            />
                            {!isGroupCollapsed && projectsWithPriority.length > 0 && (
                              <SidebarMenu className="pl-4">
                                {projectsWithPriority.map((project) => {
                                  // Convert to ProjectTreeNode format expected by ProjectItem
                                  const projectNode = {
                                    ...project,
                                    children: [], // No children in flat priority view
                                  }

                                  return (
                                    <ProjectItem
                                      key={project._id}
                                      project={projectNode}
                                      currentViewKey={currentViewKey}
                                      onViewChange={onViewChange}
                                      expandNested={false}
                                      viewContext={viewContext}
                                      toggleProjectCollapse={toggleProjectCollapse}
                                      isProjectCollapsed={isProjectCollapsed}
                                    />
                                  )
                                })}
                              </SidebarMenu>
                            )}
                          </div>
                        )
                      }

                      // Regular items (Overdue, Today, Inbox, P1 Tasks, Upcoming)
                      return (
                        <SidebarMenuItem key={pqItem.id}>
                          <SidebarButton
                            icon={icon}
                            label={pqItem.label}
                            count={count}
                            isActive={isItemActive}
                            onClick={() => onViewChange(resolveView(pqItem.viewKey, viewContext))}
                            level={1}
                          />
                        </SidebarMenuItem>
                      )
                    })}
                  </SidebarMenu>
                </CollapsibleContent>
              </Collapsible>
            )
          }

          // Regular items
          const isActive = currentViewKey === item.key

          const handleItemClick = () => {
            // Settings is a special case - open dialog instead of changing view
            if (item.key === "view:settings") {
              openSettings()
            } else {
              onViewChange(resolveView(item.key, viewContext))
            }
          }

          return (
            <SidebarMenuItem key={item.key}>
              <SidebarButton
                icon={item.icon}
                label={item.label}
                count={item.count}
                isActive={isActive}
                onClick={handleItemClick}
              />
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}
