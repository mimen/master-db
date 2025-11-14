import { ArrowDownAZ, Flag, Hash, Network, Plus } from "lucide-react"
import { type ReactNode, useState } from "react"
import {
  DndContext,
  DragOverlay,
  rectIntersection,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"

import { CollapseCaret } from "../components/CollapseCaret"
import { IconButton } from "../components/IconButton"
import { PriorityItem } from "../components/PriorityItem"
import { ProjectItem } from "../components/ProjectItem"
import { SortDropdown } from "../components/SortDropdown"
import type { ProjectSort, ProjectTreeNode } from "../types"
import { PRIORITY_PROJECTS_ITEMS } from "../utils/filterItems"
import { getSortedProjects } from "../utils/sorting"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { SidebarGroup, SidebarGroupLabel, SidebarMenu } from "@/components/ui/sidebar"
import { getProjectColor } from "@/lib/colors"
import { useOptimisticProjectPriority } from "@/hooks/useOptimisticProjectPriority"
import type { ViewBuildContext, ViewKey, ViewSelection } from "@/lib/views/types"

interface ProjectsSectionProps {
  projects: ProjectTreeNode[]
  currentViewKey: ViewKey
  onViewChange: (view: ViewSelection) => void
  viewContext: ViewBuildContext
  expandNested: boolean
  sortMode: ProjectSort
  onSortChange: (mode: ProjectSort) => void
  isCollapsed: boolean
  onToggleCollapse: () => void
  toggleProjectCollapse: (projectId: string) => void
  isProjectCollapsed: (projectId: string) => boolean
  togglePriorityGroupCollapse: (priority: number) => void
  isPriorityGroupCollapsed: (priority: number) => boolean
}

const PROJECT_SORT_MODES: readonly ProjectSort[] = ["hierarchy", "priority", "taskCount", "alphabetical"]

// DroppableZone: Makes priority groups droppable with visual feedback
function DroppableZone({ id, children, isActive }: { id: string; children: ReactNode; isActive: boolean }) {
  const { isOver, setNodeRef } = useDroppable({ id })

  return (
    <div
      ref={setNodeRef}
      className={`transition-all duration-200 ${
        isActive && isOver
          ? "bg-accent/50 rounded-md ring-2 ring-primary/30"
          : isActive
            ? "bg-accent/20 rounded-md"
            : ""
      }`}
    >
      {children}
    </div>
  )
}

// DraggableProjectItem: Wraps ProjectItem to make it draggable
function DraggableProjectItem({
  project,
  currentViewKey,
  onViewChange,
  expandNested,
  viewContext,
  toggleProjectCollapse,
  isProjectCollapsed,
}: {
  project: ProjectTreeNode
  currentViewKey: ViewKey
  onViewChange: (view: ViewSelection) => void
  expandNested: boolean
  viewContext: ViewBuildContext
  toggleProjectCollapse: (projectId: string) => void
  isProjectCollapsed: (projectId: string) => boolean
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: project.todoist_id,
  })

  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.5 : undefined,
    transition: "opacity 200ms ease",
  }

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <ProjectItem
        project={project}
        currentViewKey={currentViewKey}
        onViewChange={onViewChange}
        expandNested={expandNested}
        level={0}
        viewContext={viewContext}
        toggleProjectCollapse={toggleProjectCollapse}
        isProjectCollapsed={isProjectCollapsed}
      />
    </div>
  )
}

function getProjectSortIcon(mode: ProjectSort) {
  switch (mode) {
    case "hierarchy":
      return Network
    case "priority":
      return Flag
    case "taskCount":
      return Hash
    case "alphabetical":
      return ArrowDownAZ
  }
}

export function ProjectsSection({
  projects,
  currentViewKey,
  onViewChange,
  viewContext,
  expandNested,
  sortMode,
  onSortChange,
  isCollapsed,
  onToggleCollapse,
  toggleProjectCollapse,
  isProjectCollapsed,
  togglePriorityGroupCollapse,
  isPriorityGroupCollapsed,
}: ProjectsSectionProps) {
  const sortedProjects = getSortedProjects(projects, sortMode)
  const updateProjectPriority = useOptimisticProjectPriority()

  // DnD state
  const [activeProject, setActiveProject] = useState<ProjectTreeNode | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before drag starts (prevents accidental drags)
      },
    })
  )

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    const project = sortedProjects.find((p) => p.todoist_id === active.id)
    if (project) {
      setActiveProject(project)
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveProject(null)

    if (!over || active.id === over.id) {
      return // No-op if dropped outside or in same place
    }

    // Extract project ID and target priority
    const projectId = active.id as string
    const targetPriority = parseInt(over.id as string)

    // Get current priority to check if it's actually changing
    const project = sortedProjects.find((p) => p.todoist_id === projectId)
    const currentPriority = project?.metadata?.priority || 1

    if (currentPriority === targetPriority) {
      return // No-op if dropping in same priority group
    }

    // Update priority optimistically
    updateProjectPriority(projectId, targetPriority)
  }

  // Group projects by priority when sorting by priority
  const groupedByPriority = sortMode === "priority"
    ? sortedProjects.reduce((acc: Record<number, ProjectTreeNode[]>, project: ProjectTreeNode) => {
        const priority = project.metadata?.priority || 1
        if (!acc[priority]) acc[priority] = []
        acc[priority].push(project)
        return acc
      }, {} as Record<number, ProjectTreeNode[]>)
    : null

  const renderProjectList = () => {
    if (sortMode === "priority" && groupedByPriority) {
      // Render grouped by priority with PriorityItem headers (wrapped in DnD)
      const content = (
        <>
          {[4, 3, 2, 1].map((priorityLevel) => {
            const projectsInGroup = groupedByPriority[priorityLevel]
            if (!projectsInGroup || projectsInGroup.length === 0) return null

            // Find the corresponding priority-projects item
            const priorityItem = PRIORITY_PROJECTS_ITEMS.find((p) => p.priorityLevel === priorityLevel)
            if (!priorityItem) return null

            // Calculate total task count across all projects in this priority group
            const totalTaskCount = projectsInGroup.reduce((sum, project) => sum + (project.stats.activeCount || 0), 0)

            const isGroupCollapsed = isPriorityGroupCollapsed(priorityLevel)

            return (
              <DroppableZone key={priorityLevel} id={String(priorityLevel)} isActive={activeProject !== null}>
                <PriorityItem
                  priority={priorityItem}
                  currentViewKey={currentViewKey}
                  onViewChange={onViewChange}
                  viewContext={viewContext}
                  count={totalTaskCount}
                  isCollapsible={true}
                  isCollapsed={isGroupCollapsed}
                  onToggle={(e) => {
                    e.stopPropagation()
                    togglePriorityGroupCollapse(priorityLevel)
                  }}
                />
                {!isGroupCollapsed && (
                  <SidebarMenu className="pl-4">
                    {projectsInGroup.map((project) => (
                      <DraggableProjectItem
                        key={project._id}
                        project={project}
                        currentViewKey={currentViewKey}
                        onViewChange={onViewChange}
                        expandNested={expandNested}
                        viewContext={viewContext}
                        toggleProjectCollapse={toggleProjectCollapse}
                        isProjectCollapsed={isProjectCollapsed}
                      />
                    ))}
                  </SidebarMenu>
                )}
              </DroppableZone>
            )
          })}
        </>
      )

      return (
        <DndContext
          sensors={sensors}
          collisionDetection={rectIntersection}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {content}
          <DragOverlay>
            {activeProject ? (
              <div className="bg-sidebar rounded-md p-2 shadow-lg opacity-80 border border-border">
                <div className="flex items-center text-sm">
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0 mr-2"
                    style={{ backgroundColor: getProjectColor(activeProject.color) }}
                  />
                  <span className="font-medium">{activeProject.name}</span>
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )
    }

    // Default rendering for other sort modes
    return (
      <SidebarMenu className="space-y-px">
        {sortedProjects.map((project) => (
          <ProjectItem
            key={project._id}
            project={project}
            currentViewKey={currentViewKey}
            onViewChange={onViewChange}
            expandNested={expandNested}
            level={0}
            viewContext={viewContext}
            toggleProjectCollapse={toggleProjectCollapse}
            isProjectCollapsed={isProjectCollapsed}
          />
        ))}

        {(!sortedProjects || sortedProjects.length === 0) && (
          <p className="text-xs text-muted-foreground text-center py-4">No projects found</p>
        )}
      </SidebarMenu>
    )
  }

  return (
    <Collapsible open={!isCollapsed} onOpenChange={onToggleCollapse}>
      <SidebarGroup>
        <div className="flex items-center justify-between">
          <SidebarGroupLabel className="flex-1">Projects</SidebarGroupLabel>
          <div className="flex items-center pr-2">
            <SortDropdown
              modes={PROJECT_SORT_MODES}
              currentMode={sortMode}
              onChange={onSortChange}
              getIcon={getProjectSortIcon}
            />
            <IconButton>
              <Plus className="h-3 w-3" />
            </IconButton>
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
          {renderProjectList()}
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}
