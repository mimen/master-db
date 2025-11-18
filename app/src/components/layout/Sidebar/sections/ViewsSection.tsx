import { FolderTypeItem } from "../components/FolderTypeItem"
import { SidebarButton } from "../components/SidebarButton"
import type { ViewNavItem } from "../types"
import { FOLDER_TYPE_ITEMS } from "../utils/filterItems"

import { RoutineProjectItem } from "./RoutineProjectItem"

import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import { SidebarGroup, SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar"
import { useCountRegistry } from "@/contexts/CountContext"
import { useDialogContext } from "@/contexts/DialogContext"
import type { ViewBuildContext, ViewKey, ViewSelection } from "@/lib/views/types"
import { resolveView } from "@/lib/views/viewDefinitions"
import { useMemo } from "react"

interface ViewsSectionProps {
  items: ViewNavItem[]
  currentViewKey: ViewKey
  onViewChange: (view: ViewSelection) => void
  viewContext: ViewBuildContext
  isFoldersCollapsed: boolean
  onToggleFoldersCollapse: () => void
  isRoutinesCollapsed: boolean
  onToggleRoutinesCollapse: () => void
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
}: ViewsSectionProps) {
  const { openSettings } = useDialogContext()
  const { getCountForView, registry } = useCountRegistry()

  // Filter projects that have routines (active routine count > 0)
  const projectsWithRoutines = useMemo(() => {
    if (!viewContext.projectsWithMetadata) return []

    const allCounts = registry.getAllCounts()

    return viewContext.projectsWithMetadata
      .filter((project) => {
        const countKey = `list:routines:${project.todoist_id}`
        const count = allCounts[countKey] ?? 0
        return count > 0
      })
      .sort((a, b) => a.name.localeCompare(b.name)) // Alphabetical sort
  }, [viewContext.projectsWithMetadata, registry])

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
                  />
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
