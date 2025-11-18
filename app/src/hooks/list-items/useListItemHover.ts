import { useState } from 'react'

/**
 * Hover State Hook for List Items
 *
 * Manages hover state for list items. Extracts the common hover pattern
 * used to show ghost badges and other hover-dependent UI elements.
 *
 * @example
 * ```tsx
 * function TaskRow({ task }: TaskRowProps) {
 *   const { isHovered, onMouseEnter, onMouseLeave } = useListItemHover()
 *
 *   return (
 *     <div
 *       onMouseEnter={onMouseEnter}
 *       onMouseLeave={onMouseLeave}
 *     >
 *       {task.content}
 *       {isHovered && <GhostBadge icon={Tag} text="add label" />}
 *     </div>
 *   )
 * }
 * ```
 */

interface UseListItemHoverReturn {
  /**
   * Whether the item is currently hovered
   */
  isHovered: boolean

  /**
   * Mouse enter handler - call on list item element
   */
  onMouseEnter: () => void

  /**
   * Mouse leave handler - call on list item element
   */
  onMouseLeave: () => void
}

/**
 * Hook that manages hover state for list items
 *
 * Returns isHovered boolean and event handlers to attach to the list item element.
 * Commonly used to show/hide ghost badges and other hover-dependent UI.
 *
 * @returns Hover state and event handlers
 */
export function useListItemHover(): UseListItemHoverReturn {
  const [isHovered, setIsHovered] = useState(false)

  return {
    isHovered,
    onMouseEnter: () => setIsHovered(true),
    onMouseLeave: () => setIsHovered(false)
  }
}
