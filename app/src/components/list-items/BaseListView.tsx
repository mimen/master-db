import { X, RotateCcw } from "lucide-react"
import React, { useEffect, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useCountRegistry } from "@/contexts/CountContext"
import { useListItemFocus } from "@/hooks/list-items"
import { cn } from "@/lib/utils"
import type { ListInstance, ListSupportData } from "@/lib/views/types"

/**
 * BaseListView - Generic, reusable list view component
 *
 * Encapsulates all common list view patterns (header rendering, empty states,
 * collapse/expand, focus management, count tracking) while allowing entity-specific
 * customization through props.
 *
 * Works with any entity type through TypeScript generics and render functions.
 *
 * @example
 * ```tsx
 * <BaseListView<TodoistTaskWithProject>
 *   entities={visibleTasks}
 *   entityType="task"
 *   getEntityId={(task) => task.todoist_id}
 *   list={list}
 *   isMultiListView={true}
 *   isDismissed={false}
 *   onDismiss={onDismiss}
 *   onRestore={onRestore}
 *   isLoading={tasks === undefined}
 *   focusedIndex={focusedTaskIndex}
 *   setFocusedEntity={setFocusedTaskIndex}
 *   setFocusedEntityInContext={setFocusedTask}
 *   useEntityShortcuts={useTaskDialogShortcuts}
 *   onEntityCountChange={onTaskCountChange}
 *   onEntityClick={onTaskClick}
 *   renderRow={(task, index, ref) => (
 *     <TaskListItem task={task} onElementRef={ref} onClick={() => onTaskClick?.(list.id, index)} />
 *   )}
 * />
 * ```
 */

export interface BaseListViewProps<T> {
  // ============= ENTITY CONFIGURATION =============

  /**
   * Array of entities to render
   */
  entities: T[]

  /**
   * Entity type identifier ("task" | "project" | "routine" | string)
   * Used for data attributes and keyboard shortcuts context
   */
  entityType: string

  /**
   * Function to extract unique ID from entity
   * Used as React key and for data attributes
   */
  getEntityId: (entity: T) => string

  // ============= RENDER PROPS =============

  /**
   * Render function for each entity row
   * Returns fully rendered row component (TaskListItem, ProjectListItem, etc.)
   *
   * @param entity Current entity to render
   * @param index Position in entities array (used for focus management)
   * @param onElementRef Callback to register element ref for focus management
   */
  renderRow: (entity: T, index: number, onElementRef: (el: HTMLDivElement | null) => void) => React.ReactNode

  // ============= LIST CONFIGURATION =============

  /**
   * ListInstance from views system
   * Provides header, empty state, and configuration
   */
  list: ListInstance

  /**
   * Parent callback: called when visible entity count changes
   *
   * @param listId Unique identifier of this list (list.id)
   * @param count Number of visible entities (respects maxTasks limit)
   */
  onEntityCountChange?: (listId: string, count: number) => void

  /**
   * Parent callback: called when entity is clicked
   *
   * @param listId Unique identifier of this list
   * @param index Index of clicked entity in visible array
   */
  onEntityClick?: (listId: string, entityIndex: number) => void

  // ============= FOCUS MANAGEMENT =============

  /**
   * Current focused entity index (from parent state)
   * Parent manages this via useState + FocusContext
   * Null or -1 means no entity is focused
   */
  focusedIndex: number | null

  /**
   * Callback to update focused entity index in parent
   * Called when user navigates with arrow keys
   */
  setFocusedEntity: (index: number | null) => void

  /**
   * Hook that provides entity-specific keyboard shortcuts
   * Called with currently focused entity
   *
   * @param entity Current focused entity or null
   */
  useEntityShortcuts: (entity: T | null) => void

  /**
   * Callback for focus context update
   * Called when focused entity changes to update global FocusContext
   */
  setFocusedEntityInContext?: (entity: T | null) => void

  // ============= MULTI-LIST VIEW OPTIONS =============

  /**
   * Whether this is part of a multi-list view or standalone
   * Affects header visibility, expand/collapse UI, empty state display
   */
  isMultiListView?: boolean

  /**
   * Whether this list is currently dismissed (collapsed in multi-list view)
   * Only used when isMultiListView={true}
   */
  isDismissed?: boolean

  /**
   * Callback: user clicked collapse button (X icon)
   */
  onDismiss?: (listId: string) => void

  /**
   * Callback: user clicked expand button (RotateCcw icon)
   */
  onRestore?: (listId: string) => void

  // ============= LOADING STATE =============

  /**
   * Whether data is still loading
   */
  isLoading?: boolean

  // ============= OPTIONAL STYLING =============

  /**
   * Additional className for wrapper div
   */
  className?: string
}

export function BaseListView<T>({
  entities,
  entityType,
  getEntityId,
  renderRow,
  list,
  onEntityCountChange,
  onEntityClick,
  focusedIndex,
  useEntityShortcuts,
  setFocusedEntityInContext,
  isMultiListView = false,
  isDismissed = false,
  onDismiss,
  onRestore,
  isLoading = false,
  className,
}: BaseListViewProps<T>) {
  const [isExpanded, setIsExpanded] = useState(list.startExpanded)
  const { registry } = useCountRegistry()

  // Setup ref array for focus management
  const elementRefs = useRef<(HTMLDivElement | null)[]>([])
  const refHandlers = useRef<((element: HTMLDivElement | null) => void)[]>([])

  // Initialize ref handlers for each entity
  elementRefs.current.length = entities.length
  refHandlers.current.length = entities.length

  for (let i = 0; i < entities.length; i++) {
    if (!refHandlers.current[i]) {
      refHandlers.current[i] = (element) => {
        elementRefs.current[i] = element
      }
    }
  }

  // Get focused entity
  const focusedEntity =
    focusedIndex !== null &&
    focusedIndex >= 0 &&
    focusedIndex < entities.length
      ? entities[focusedIndex]
      : null

  // Update global focus context when focused entity changes
  useEffect(() => {
    setFocusedEntityInContext?.(focusedEntity)
  }, [focusedEntity, setFocusedEntityInContext])

  // Call entity-specific shortcuts hook with focused entity
  useEntityShortcuts(focusedEntity)

  // Use shared focus management hook
  useListItemFocus({
    entityType,
    focusedIndex,
    entitiesLength: entities.length,
    elementRefs,
    onExpand: () => setIsExpanded(true)
  })

  // Report visible count to parent
  useEffect(() => {
    onEntityCountChange?.(list.id, entities.length)
  }, [list.id, onEntityCountChange, entities.length])

  // Sync isExpanded state with isDismissed prop
  useEffect(() => {
    if (isDismissed) {
      setIsExpanded(false)
    } else {
      setIsExpanded(list.startExpanded)
    }
  }, [isDismissed, list.startExpanded])

  // Get total count from registry
  const totalCount = registry.getCountForList(list.id, list.query)

  // Get header and empty state from list
  const header = list.getHeader({
    params: list.params,
    taskCount: entities.length,
    support: {} as ListSupportData,
  })

  const emptyState = list.getEmptyState({
    params: list.params,
    taskCount: entities.length,
    support: {} as ListSupportData,
  })

  // Determine if we should show compact view
  const shouldShowCompact = isMultiListView && (entities.length === 0 || isDismissed)

  // LOADING STATE
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Loading {entityType}s...</p>
      </div>
    )
  }

  // COMPACT VIEW (dismissed or empty in multi-list)
  if (shouldShowCompact) {
    const countText = totalCount === 0 ? "Empty" : `${totalCount}`

    return (
      <div className={cn("max-w-4xl mx-auto px-6 py-2", className)}>
        <div className="flex items-center gap-3 text-sm">
          <div className="text-muted-foreground">{header.icon}</div>
          <span className="flex-1 font-medium text-foreground/70">{header.title}</span>
          <Badge variant="secondary" className="text-xs font-normal">
            {countText}
          </Badge>
          {entities.length > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onRestore?.(list.id)}
                    className="p-1.5 hover:bg-accent rounded-md transition-colors text-muted-foreground hover:text-foreground"
                    aria-label="Expand list"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  Expand list
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>
    )
  }

  // FULL VIEW
  return (
    <div
      className={cn(
        "max-w-4xl mx-auto px-6",
        isMultiListView ? "py-4" : "py-0",
        className
      )}
    >
      {/* HEADER (multi-list view only) */}
      {isMultiListView && (
        <div className="mb-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="text-muted-foreground">{header.icon}</div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold tracking-tight">{header.title}</h2>
              {header.description && (
                <p className="text-sm text-muted-foreground mt-0.5">{header.description}</p>
              )}
            </div>
            <Badge variant="secondary" className="text-xs font-normal shrink-0">
              {list.maxTasks && entities.length < totalCount
                ? `Showing ${entities.length} of ${totalCount}`
                : totalCount}
            </Badge>
            {entities.length > 0 && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => onDismiss?.(list.id)}
                      className="p-1.5 hover:bg-accent rounded-md transition-colors text-muted-foreground hover:text-foreground"
                      aria-label="Collapse list"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Collapse list
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          <Separator />
        </div>
      )}

      {/* ENTITY LIST OR EMPTY STATE */}
      {(isExpanded || !isMultiListView) && (
        <>
          {entities.length > 0 ? (
            <div className="space-y-1">
              {entities.map((entity: T, index: number) => (
                <div
                  key={getEntityId(entity)}
                  data-testid={`${entityType}-row-${index}`}
                  data-entity-type={entityType}
                  data-entity-id={getEntityId(entity)}
                  onClick={() => onEntityClick?.(list.id, index)}
                >
                  {renderRow(entity, index, refHandlers.current[index]!)}
                </div>
              ))}
            </div>
          ) : list.collapsible && isMultiListView ? (
            // Compact empty state for collapsible lists in multi-list view
            <div className="py-4 text-sm text-muted-foreground text-center">
              No {entityType}s
            </div>
          ) : !isMultiListView ? (
            // Full empty state for single view
            <div className="flex flex-col items-center justify-center h-64 text-center px-4">
              <p className="text-lg font-semibold mb-1">{emptyState.title}</p>
              {emptyState.description && (
                <p className="text-sm text-muted-foreground max-w-md">{emptyState.description}</p>
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
