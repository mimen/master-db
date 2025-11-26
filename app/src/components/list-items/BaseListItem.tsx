import { forwardRef, useEffect } from "react"

import { useListItemHover, useListItemEditing, useOptimisticSync } from "@/hooks/list-items"
import { cn } from "@/lib/utils"

/**
 * BaseListItem - Generic, reusable list item component
 *
 * Encapsulates common list item patterns (hover, editing, focus management, styling)
 * Works with any entity type through TypeScript generics and render props.
 *
 * @example
 * ```tsx
 * <BaseListItem<Task>
 *   entity={task}
 *   entityType="task"
 *   getEntityId={(t) => t.todoist_id}
 *
 *   renderLeftElement={(isHovered) => <Checkbox ... />}
 *   renderPrimaryDisplay={(task) => <Content ... />}
 *   renderSecondaryDisplay={(task) => task.description}
 *   renderFixedBadges={(task) => <TaskBadges ... />}
 *   renderHoverBadges={(task) => <GhostBadges ... />}
 *
 *   primaryField={{ value: task.content, key: 'content' }}
 *   secondaryField={{ value: task.description, key: 'description' }}
 *   onSave={async (changes) => await updateTask(changes)}
 *
 *   onClick={() => handleClick(task)}
 *   onElementRef={refCallback}
 *
 *   contentDisplayMode="wrap"
 * />
 * ```
 */

export interface BaseListItemProps<T> {
  /**
   * Entity instance
   */
  entity: T

  /**
   * Entity type identifier ("task" | "project" | "routine" | string)
   * Used for data attributes and keyboard shortcuts
   */
  entityType: string

  /**
   * Function to extract unique ID from entity
   * @example getEntityId={(task) => task.todoist_id}
   */
  getEntityId: (entity: T) => string

  // ============= RENDER PROPS =============

  /**
   * Render left element (checkbox, color dot, icon, etc)
   * @param isHovered True if row is currently hovered
   */
  renderLeftElement?: (isHovered: boolean) => React.ReactNode

  /**
   * Render primary content (name/title)
   * Return just the content - BaseListItem handles styling
   * Called only in display mode, not when editing
   */
  renderPrimaryDisplay: (entity: T) => React.ReactNode

  /**
   * Render secondary content (description) or null to hide
   * Return just the content - BaseListItem handles styling
   * Called only in display mode, not when editing
   */
  renderSecondaryDisplay?: (entity: T) => React.ReactNode | null

  /**
   * Render fixed badges (always shown, not hover-dependent)
   * @param entity Current entity
   * @param isHovered True if row is hovered
   */
  renderFixedBadges?: (entity: T, isHovered: boolean) => React.ReactNode

  /**
   * Render hover-only badges (shown only on hover)
   * @param entity Current entity
   */
  renderHoverBadges?: (entity: T) => React.ReactNode

  // ============= EDITING CONFIGURATION =============

  /**
   * Primary field configuration (name/content)
   */
  primaryField?: {
    value: string
    placeholder?: string
    /**
     * Key used in onSave changes object
     * @default "name"
     */
    key?: string
  }

  /**
   * Secondary field configuration (description)
   * If not provided, secondary editing is disabled
   */
  secondaryField?: {
    value: string | undefined
    placeholder?: string
    /**
     * Key used in onSave changes object
     * @default "description"
     */
    key?: string
  }

  /**
   * Called when user saves edited content
   * @param changes Object with edited fields: { [key]: value }
   */
  onSave?: (changes: Record<string, string | undefined>) => Promise<void>

  // ============= INTERACTION HANDLERS =============

  /**
   * Called when row is clicked
   * Render props (badge clicks) should call stopPropagation before this
   */
  onClick?: () => void

  /**
   * Ref callback for parent's focus management
   * Parent uses this to build ref array for keyboard shortcuts
   */
  onElementRef?: (element: HTMLDivElement | null) => void

  // ============= STYLING & CLASS OPTIONS =============

  /**
   * Primary content display mode
   * @default "wrap"
   */
  contentDisplayMode?: "wrap" | "truncate"

  /**
   * Class applied when item is archived/deferred
   * @example "opacity-60"
   */
  archivedClass?: string

  /**
   * Additional wrapper classes
   */
  className?: string
}

export const BaseListItem = forwardRef<HTMLDivElement, BaseListItemProps<any> & Record<string, any>>(
  function BaseListItem(
    {
      entity,
      entityType,
      getEntityId,
      renderLeftElement,
      renderPrimaryDisplay,
      renderSecondaryDisplay,
      renderFixedBadges,
      renderHoverBadges,
      primaryField,
      secondaryField,
      onSave,
      onClick,
      onElementRef,
      contentDisplayMode = "wrap",
      archivedClass,
      className,
      ...restProps
    },
    ref
  ) {
    // Track hover state
    const { isHovered, onMouseEnter, onMouseLeave } = useListItemHover()

    // Manage editing state
    const editing = useListItemEditing({
      entity,
      entityId: getEntityId(entity),
      fields: {
        primary: {
          value: primaryField?.value || "",
          key: primaryField?.key || "name",
        },
        secondary: secondaryField
          ? {
              value: secondaryField.value || "",
              key: secondaryField.key || "description",
            }
          : undefined,
      },
      onSave: async (changes) => {
        await onSave?.(changes)
      },
    })

    // Forward ref to callback
    useEffect(() => {
      if (ref) {
        if (typeof ref === "function") {
          ref(null) // This is for the forwardRef, but we also use onElementRef
        } else {
          ref.current = null // This will be set below
        }
      }
      onElementRef?.(null) // This will be set below
    }, [])

    // Handle wrapper ref
    const handleRef = (element: HTMLDivElement | null) => {
      if (ref) {
        if (typeof ref === "function") {
          ref(element)
        } else {
          ref.current = element
        }
      }
      onElementRef?.(element)

      // Expose editing methods on element for keyboard shortcuts
      if (element) {
        ;(element as any).startEditing = editing.startEditing
        ;(element as any).startEditingDescription = editing.startEditingSecondary
      }
    }

    return (
      <div
        ref={handleRef}
        tabIndex={-1}
        aria-selected={false}
        data-entity-type={entityType}
        data-entity-id={getEntityId(entity)}
        className={cn(
          "group cursor-pointer transition-all duration-150 rounded-md border border-transparent p-2.5",
          "hover:bg-accent/50",
          "focus:outline-none focus:bg-accent/50 focus:border-primary/30",
          archivedClass,
          className
        )}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={onClick}
        {...restProps}
      >
        <div className="flex items-start gap-2.5">
          {/* Left Element Slot */}
          {renderLeftElement && (
            <div className="flex-shrink-0">
              {renderLeftElement(isHovered)}
            </div>
          )}

          {/* Content Area */}
          <div className="flex-1 min-w-0 space-y-1.5">
            {/* Primary Field (Editable or Display) */}
            <div onClick={(e) => e.stopPropagation()}>
              {editing.isEditing ? (
                <input
                  ref={editing.primaryInputRef}
                  type="text"
                  value={editing.primaryValue}
                  onChange={(e) => editing.setPrimaryValue(e.target.value)}
                  onKeyDown={editing.handlePrimaryKeyDown}
                  placeholder={primaryField?.placeholder || "Name"}
                  className="block w-full bg-transparent px-0 py-0 m-0 text-sm font-medium leading-relaxed text-foreground outline-none border-none break-words"
                  autoFocus
                />
              ) : (
                <div className="font-medium text-sm leading-relaxed break-words">
                  {renderPrimaryDisplay(entity)}
                </div>
              )}
            </div>

            {/* Secondary Field (Editable or Display) */}
            {secondaryField && (
              <div onClick={(e) => e.stopPropagation()}>
                {editing.isEditing ? (
                  editing.showSecondaryInput && (
                    <input
                      ref={editing.secondaryInputRef}
                      type="text"
                      value={editing.secondaryValue}
                      onChange={(e) => editing.setSecondaryValue(e.target.value)}
                      onKeyDown={editing.handleSecondaryKeyDown}
                      placeholder={secondaryField.placeholder || "Description"}
                      className="block w-full bg-transparent px-0 py-0 m-0 mt-1 text-xs leading-relaxed text-muted-foreground outline-none border-none placeholder:text-muted-foreground/70 break-words"
                    />
                  )
                ) : renderSecondaryDisplay ? (
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed break-words">
                    {renderSecondaryDisplay(entity)}
                  </p>
                ) : null}
              </div>
            )}

            {/* Badges Container */}
            <div className="flex flex-wrap items-center gap-1">
              {/* Fixed Badges */}
              {renderFixedBadges?.(entity, isHovered)}

              {/* Hover-Only Badges */}
              {isHovered && renderHoverBadges?.(entity)}
            </div>
          </div>
        </div>
      </div>
    )
  }
)

BaseListItem.displayName = "BaseListItem"
