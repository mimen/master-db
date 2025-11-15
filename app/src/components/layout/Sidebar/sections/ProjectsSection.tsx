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
  type DragOverEvent,
} from "@dnd-kit/core"
import { ArrowDownAZ, Flag, Hash, Network, Plus } from "lucide-react"
import { type ReactNode, useState } from "react"

import { HierarchicalDropIndicator } from "../components/HierarchicalDropIndicator"
import { CollapseCaret } from "../components/CollapseCaret"
import { IconButton } from "../components/IconButton"
import { PriorityItem } from "../components/PriorityItem"
import { ProjectItem } from "../components/ProjectItem"
import { SortDropdown } from "../components/SortDropdown"
import type { ProjectSort, ProjectTreeNode } from "../types"
import { PRIORITY_PROJECTS_ITEMS } from "../utils/filterItems"
import { getSortedProjects } from "../utils/sorting"
import { enrichTreeWithDnDMetadata, flattenProjects } from "../utils/projectTree"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { SidebarGroup, SidebarGroupLabel, SidebarMenu } from "@/components/ui/sidebar"
import { useOptimisticUpdates } from "@/contexts/OptimisticUpdatesContext"
import { useOptimisticProjectPriority } from "@/hooks/useOptimisticProjectPriority"
import { useOptimisticProjectHierarchy } from "@/hooks/useOptimisticProjectHierarchy"
import { getProjectColor } from "@/lib/colors"
import { getDropZone } from "@/lib/dnd/getDropZone"
import { validateDrop, getNewParentAndOrder } from "@/lib/dnd/validateDrop"
import type { DropZone } from "@/lib/dnd/types"
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

// DraggableProjectItem: Wraps ProjectItem to make it draggable AND droppable
function DraggableProjectItem({
  project,
  currentViewKey,
  onViewChange,
  expandNested,
  viewContext,
  toggleProjectCollapse,
  isProjectCollapsed,
  renderChildren = true,
}: {
  project: ProjectTreeNode
  currentViewKey: ViewKey
  onViewChange: (view: ViewSelection) => void
  expandNested: boolean
  viewContext: ViewBuildContext
  toggleProjectCollapse: (projectId: string) => void
  isProjectCollapsed: (projectId: string) => boolean
  renderChildren?: boolean
}) {
  const { attributes, listeners, setNodeRef: setDraggableRef, transform, isDragging } = useDraggable({
    id: project.todoist_id,
  })

  const { setNodeRef: setDroppableRef } = useDroppable({
    id: project.todoist_id,
  })

  // Combine both refs
  const setRefs = (element: HTMLDivElement | null) => {
    setDraggableRef(element)
    setDroppableRef(element)
  }

  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.5 : undefined,
    transition: "opacity 200ms ease",
  }

  return (
    <div id={`project-${project.todoist_id}`} ref={setRefs} style={style} {...listeners} {...attributes}>
      <ProjectItem
        project={project}
        currentViewKey={currentViewKey}
        onViewChange={onViewChange}
        expandNested={expandNested}
        level={0}
        viewContext={viewContext}
        toggleProjectCollapse={toggleProjectCollapse}
        isProjectCollapsed={isProjectCollapsed}
        renderChildren={renderChildren}
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
  let sortedProjects = getSortedProjects(projects, sortMode)

  // Enrich with DnD metadata when in hierarchy mode
  if (sortMode === "hierarchy") {
    sortedProjects = enrichTreeWithDnDMetadata(sortedProjects)
  }

  // Flatten projects for DnD operations (find any project by ID, including children)
  const flatProjects = sortMode === "hierarchy" ? flattenProjects(sortedProjects) : sortedProjects

  const updateProjectPriority = useOptimisticProjectPriority()
  const updateProjectHierarchy = useOptimisticProjectHierarchy()
  const { getProjectUpdate } = useOptimisticUpdates()

  // DnD state
  const [activeProject, setActiveProject] = useState<ProjectTreeNode | null>(null)
  const [dropZone, setDropZone] = useState<DropZone | null>(null)
  const [isValidDrop, setIsValidDrop] = useState(false)
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before drag starts (prevents accidental drags)
      },
    })
  )

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    const project = flatProjects.find((p) => p.todoist_id === active.id)
    if (project) {
      setActiveProject(project)
    }
  }

  const handleDragOver = (event: DragOverEvent) => {
    if (sortMode !== "hierarchy" || !activeProject) return

    const { over } = event
    if (!over) {
      setDropZone(null)
      return
    }

    const targetProject = flatProjects.find((p) => p.todoist_id === over.id)
    if (!targetProject) {
      setDropZone(null)
      return
    }

    // Get target rect from DOM
    const element = document.getElementById(`project-${over.id}`)
    if (!element) return

    const rect = element.getBoundingClientRect()
    setTargetRect(rect)

    // For drop zone calculation, we calculate zones based purely on rect position
    // Left/middle/right zones are determined by horizontal position within the rect
    const relativeX = (over.rect?.initial?.x ?? rect.x) % rect.width
    const verticalPercent = (over.rect?.initial?.y ?? rect.y) % rect.height > rect.height / 2 ? 1 : 0

    // Calculate drop zone using simplified approach
    const horizontalPercent = relativeX / rect.width
    const zone = getDropZone({
      mouseX: rect.left + relativeX,
      mouseY: rect.top + (verticalPercent > 0.5 ? rect.height : 0),
      projectRect: rect,
      targetProject,
      allProjects: flatProjects,
    })

    setDropZone(zone)

    // Validate drop
    const validation = validateDrop({
      draggedProject: activeProject,
      dropZone: zone,
      allProjects: flatProjects,
    })

    setIsValidDrop(validation.valid)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveProject(null)
    setDropZone(null)
    setIsValidDrop(false)
    setTargetRect(null)

    if (sortMode === "priority") {
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
    } else if (sortMode === "hierarchy" && dropZone && isValidDrop && active.id) {
      // Hierarchy drag-and-drop: move project to new parent/position
      const projectId = active.id as string
      const { parentId, childOrder } = getNewParentAndOrder(dropZone)

      // Update hierarchy optimistically
      updateProjectHierarchy(projectId, parentId, childOrder)
    }
  }

  // Group projects by priority when sorting by priority
  // IMPORTANT: Apply optimistic priority overrides BEFORE grouping
  const groupedByPriority = sortMode === "priority"
    ? sortedProjects.reduce((acc: Record<number, ProjectTreeNode[]>, project: ProjectTreeNode) => {
        // Check for optimistic priority update
        const optimisticUpdate = getProjectUpdate(project.todoist_id)
        const priority =
          optimisticUpdate?.type === "priority-change"
            ? optimisticUpdate.newPriority
            : project.metadata?.priority || 1

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

    // Hierarchy mode rendering with DnD
    if (sortMode === "hierarchy") {
      const renderHierarchyItem = (project: ProjectTreeNode): ReactNode => (
        <div key={project._id}>
          <DraggableProjectItem
            project={project}
            currentViewKey={currentViewKey}
            onViewChange={onViewChange}
            expandNested={expandNested}
            viewContext={viewContext}
            toggleProjectCollapse={toggleProjectCollapse}
            isProjectCollapsed={isProjectCollapsed}
            renderChildren={false} // Disable ProjectItem's recursion - renderHierarchyItem handles it
          />
          {/* Recursively render children with indentation */}
          {project.children.length > 0 && (
            <div style={{ marginLeft: "16px" }}>
              {project.children.map((child: ProjectTreeNode) => renderHierarchyItem(child))}
            </div>
          )}
        </div>
      )

      const content = (
        <SidebarMenu className="space-y-px">
          {sortedProjects.map((project) => renderHierarchyItem(project))}

          {(!sortedProjects || sortedProjects.length === 0) && (
            <p className="text-xs text-muted-foreground text-center py-4">No projects found</p>
          )}
        </SidebarMenu>
      )

      return (
        <DndContext
          sensors={sensors}
          collisionDetection={rectIntersection}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {content}

          {/* Drop zone indicator */}
          {dropZone && targetRect && (
            <HierarchicalDropIndicator dropZone={dropZone} isValid={isValidDrop} targetRect={targetRect} />
          )}

          {/* Drag overlay with indentation preview */}
          <DragOverlay>
            {activeProject ? (
              <div
                className={`bg-sidebar rounded-md p-2 shadow-lg border ${
                  isValidDrop ? "border-blue-500 opacity-100" : "border-red-500 opacity-50"
                }`}
                style={{
                  marginLeft: dropZone ? `${dropZone.newLevel * 16}px` : undefined,
                }}
              >
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
