import { ArrowDownAZ, Hash, Network } from "lucide-react"
import { useMemo } from "react"

import { FolderTypeItem } from "../components/FolderTypeItem"
import { SidebarButton } from "../components/SidebarButton"
import { SortDropdown } from "../components/SortDropdown"
import type { RoutineSort, ViewNavItem } from "../types"
import { FOLDER_TYPE_ITEMS } from "../utils/filterItems"

import { RoutineProjectItem } from "./RoutineProjectItem"

import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import { SidebarGroup, SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar"
import { useCountRegistry } from "@/contexts/CountContext"
import { useDialogContext } from "@/contexts/DialogContext"
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
