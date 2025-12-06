import { X, RotateCcw } from "lucide-react"
import React, { useMemo, useEffect, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { CollapsibleGroupHeader } from "@/components/ui/CollapsibleGroupHeader"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ViewSettingsDropdown } from "@/components/ui/ViewSettingsDropdown"
import { useCountRegistry } from "@/contexts/CountContext"
import { useHeaderSlotContent } from "@/contexts/HeaderSlotContext"
import { useListViewSettings } from "@/hooks/list-items/useListViewSettings"
import { cn } from "@/lib/utils"
import { applyGroupingAndSorting } from "@/lib/views/sortAndGroup"
import type { ListInstance, ListSupportData, SortOption, GroupOption, GroupData } from "@/lib/views/types"

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
   * @param query Query definition for this list (for filter matching)
   */
  renderRow: (entity: T, index: number, onElementRef: (el: HTMLDivElement | null) => void, query: import("@/lib/views/types").ListQueryInput) => React.ReactNode

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
   * Parent callback: called when entities change (for cursor navigation)
   *
   * @param listId Unique identifier of this list
   * @param entities Array of entities currently displayed
   */
  onEntitiesChange?: (listId: string, entities: T[]) => void

  /**
   * Parent callback: called when entity is clicked
   *
   * @param listId Unique identifier of this list
   * @param entityId ID of clicked entity
   */
  onEntityClick?: (listId: string, entityId: string) => void

  // ============= FOCUS MANAGEMENT =============

  /**
   * Current focused entity ID (from parent state)
   * Parent manages this via useState + FocusContext
   * Null means no entity is focused
   */
  focusedEntityId: string | null

  /**
   * Callback when entity is removed (for cursor management)
   * Called immediately when entity is optimistically removed
   */
  onEntityRemoved?: (listId: string, entityId: string) => void

  /**
   * Hook that provides entity-specific keyboard shortcuts
   * Called with currently focused entity
   *
   * @param entity Current focused entity or null
   */
  useEntityShortcuts: (entity: T | null) => void

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

  // ============= SORT & GROUP OPTIONS =============

  /**
   * Available sort options for this list
   * If provided, sort controls appear in header
   */
  sortOptions?: SortOption<T>[]

  /**
   * Available group options for this list
   * If provided, group controls appear in header
   */
  groupOptions?: GroupOption<T>[]

  /**
   * Lookup data for group labels
   * Example: { projects: [...], labels: [...] }
   * Required if groupOptions is provided
   */
  groupData?: GroupData

  /**
   * Default sort option ID
   * @default null (no sort)
   */
  defaultSort?: string

  /**
   * Default group option ID
   * @default null (no group)
   */
  defaultGroup?: string

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
  onEntitiesChange,
  onEntityClick,
  focusedEntityId,
  onEntityRemoved,
  useEntityShortcuts,
  isMultiListView = false,
  isDismissed = false,
  onDismiss,
  onRestore,
  isLoading = false,
  sortOptions,
  groupOptions,
  groupData,
  defaultSort,
  defaultGroup,
  className,
}: BaseListViewProps<T>) {
  const [isExpanded, setIsExpanded] = useState(list.startExpanded)
  const { registry } = useCountRegistry()

  // Load sort/group settings from localStorage
  const { currentSort, setCurrentSort, currentGroup, setCurrentGroup, collapsedGroups, toggleGroupCollapse } =
    useListViewSettings(list.id, defaultSort, defaultGroup)

  // Build the view settings dropdown (used in both single-list and multi-list views)
  // IMPORTANT: Memoize to prevent infinite re-render loop in HeaderSlotContext
  const viewSettingsDropdown = useMemo(() => {
    if (!sortOptions && !groupOptions) return null
    return (
      <ViewSettingsDropdown<T>
        sortOptions={sortOptions}
        currentSort={currentSort}
        onSortChange={setCurrentSort}
        groupOptions={groupOptions}
        currentGroup={currentGroup}
        onGroupChange={setCurrentGroup}
        triggerLabel="View"
      />
    )
  }, [sortOptions, currentSort, setCurrentSort, groupOptions, currentGroup, setCurrentGroup])

  // Register dropdown to header slot for single-list views
  // For multi-list views, dropdown renders inline in each list's header
  useHeaderSlotContent(
    "view-settings",
    !isMultiListView ? viewSettingsDropdown : null
  )

  // Find active sort/group options
  const activeSortOption = sortOptions?.find((opt) => opt.id === currentSort)
  const activeGroupOption = groupOptions?.find((opt) => opt.id === currentGroup)

  // Apply sorting and grouping to entities
  const processedData = useMemo(() => {
    return applyGroupingAndSorting(entities, activeSortOption, activeGroupOption, groupData)
  }, [entities, activeSortOption, activeGroupOption, groupData])

  // Determine if data is grouped (array of GroupedEntities) vs flat (array of entities)
  const isGrouped = Array.isArray(processedData) && processedData.length > 0 && "groupKey" in processedData[0]
  const groupedData = isGrouped ? (processedData as any[]) : null

  // Build flat array of visible entities (excluding collapsed groups) for focus management
  const visibleEntities: T[] = useMemo(() => {
    if (groupedData) {
      return groupedData.flatMap((group) =>
        collapsedGroups.has(group.groupKey) ? [] : group.entities
      )
    }
    return processedData as T[]
  }, [groupedData, collapsedGroups, processedData])

  // Convert entity ID to index for rendering and focus management
  const focusedIndex = useMemo(() => {
    if (!focusedEntityId) return null
    const index = visibleEntities.findIndex(e => getEntityId(e) === focusedEntityId)
    return index === -1 ? null : index
  }, [visibleEntities, focusedEntityId, getEntityId])

  // Setup ref map for focus management (using Map to avoid index shifting issues)
  const elementRefsMap = useRef<Map<string, HTMLDivElement | null>>(new Map())
  const elementRefs = useRef<(HTMLDivElement | null)[]>([])
  const refHandlers = useRef<((element: HTMLDivElement | null) => void)[]>([])

  // Build index-based refs array from Map for keyboard shortcut access
  elementRefs.current = visibleEntities.map((entity) => {
    const entityId = getEntityId(entity)
    return elementRefsMap.current.get(entityId) ?? null
  })

  // Initialize ref handlers for visible entities
  refHandlers.current.length = visibleEntities.length
  for (let i = 0; i < visibleEntities.length; i++) {
    const entityId = getEntityId(visibleEntities[i])
    refHandlers.current[i] = (element) => {
      elementRefsMap.current.set(entityId, element)
    }
  }

  // Get focused entity (from visible entities array)
  const focusedEntity =
    focusedIndex !== null &&
    focusedIndex >= 0 &&
    focusedIndex < visibleEntities.length
      ? visibleEntities[focusedIndex]
      : null

  // Call entity-specific shortcuts hook with focused entity
  useEntityShortcuts(focusedEntity)

  // Report visible count to parent
  useEffect(() => {
    onEntityCountChange?.(list.id, entities.length)
  }, [list.id, onEntityCountChange, entities.length])

  // Report visible entities to parent (for cursor navigation)
  // Only update when entity IDs actually change (not just array reference)
  const visibleEntityIds = useMemo(
    () => visibleEntities.map(e => getEntityId(e)).join(','),
    [visibleEntities, getEntityId]
  )

  useEffect(() => {
    onEntitiesChange?.(list.id, visibleEntities)
  }, [list.id, onEntitiesChange, visibleEntityIds]) // Use visibleEntityIds instead of visibleEntities

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
            {/* Sort/Group Settings Dropdown (only inline for multi-list views) */}
            {viewSettingsDropdown}
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
            groupedData ? (
              // GROUPED RENDERING
              <div className="space-y-2">
                {groupedData.map((group) => (
                  <div key={group.groupKey}>
                    {/* Group Header */}
                    <CollapsibleGroupHeader
                      groupKey={group.groupKey}
                      label={group.groupLabel}
                      count={group.entities.length}
                      isCollapsed={collapsedGroups.has(group.groupKey)}
                      onToggle={toggleGroupCollapse}
                    />

                    {/* Group Entities */}
                    {!collapsedGroups.has(group.groupKey) && (
                      <div className="space-y-1 pl-1">
                        {group.entities.map((entity: T, groupEntityIndex: number) => {
                          // Find index in visibleEntities array for focus management
                          const visibleIndex = visibleEntities.indexOf(entity)
                          const entityId = getEntityId(entity)
                          return (
                            <div
                              key={entityId}
                              data-testid={`${entityType}-row-${visibleIndex}`}
                            >
                              {renderRow(
                                entity,
                                visibleIndex,
                                visibleIndex >= 0 ? refHandlers.current[visibleIndex]! : () => {},
                                list.query
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              // FLAT RENDERING
              <div className="space-y-1">
                {(processedData as T[]).map((entity: T, index: number) => {
                  const entityId = getEntityId(entity)
                  return (
                    <div
                      key={entityId}
                      data-testid={`${entityType}-row-${index}`}
                    >
                      {renderRow(entity, index, refHandlers.current[index]!, list.query)}
                    </div>
                  )
                })}
              </div>
            )
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
