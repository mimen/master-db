import { useLayoutEffect, useRef } from 'react'

/**
 * Focus Management Hook for List Items
 *
 * Manages focus highlighting, scrolling, and aria attributes for list items.
 * Extracts the common focus management pattern used across Tasks, Projects, and Routines.
 *
 * Focus is indicated via aria-selected attribute, which is styled in BaseListItem via
 * aria-selected:bg-accent/50 and aria-selected:border-primary/30 classes.
 *
 * @example
 * ```tsx
 * function TaskListView() {
 *   const taskRefs = useRef<(HTMLDivElement | null)[]>([])
 *   const [focusedIndex, setFocusedIndex] = useState(0)
 *
 *   useListItemFocus({
 *     focusedIndex,
 *     entitiesLength: tasks.length,
 *     elementRefs: taskRefs
 *   })
 *
 *   return tasks.map((task, index) => (
 *     <div ref={(el) => taskRefs.current[index] = el}>
 *       {task.content}
 *     </div>
 *   ))
 * }
 * ```
 */

interface UseListItemFocusOptions {
  /**
   * Current focused index (0-based)
   * null means no item is focused
   */
  focusedIndex: number | null

  /**
   * Length of the entities array
   * Used to validate focusedIndex is in bounds
   */
  entitiesLength: number

  /**
   * Ref array holding DOM elements
   * Should be a ref to an array of HTMLDivElement | null
   */
  elementRefs: React.MutableRefObject<(HTMLDivElement | null)[]>

  /**
   * Optional: Expand list when focusing (for collapsible lists)
   */
  onExpand?: () => void
}

/**
 * Hook that manages focus state for list items
 *
 * Features:
 * - Applies/removes highlight classes when focus changes
 * - Scrolls focused item into view
 * - Updates aria-selected attributes
 * - Handles focus on DOM element
 * - Validates index bounds
 *
 * @param options Focus management options
 */
export function useListItemFocus({
  focusedIndex,
  entitiesLength,
  elementRefs,
  onExpand
}: UseListItemFocusOptions) {
  const lastFocusedIndex = useRef<number | null>(null)

  useLayoutEffect(() => {
    // Remove aria-selected from previously focused item
    if (lastFocusedIndex.current !== null && lastFocusedIndex.current !== focusedIndex) {
      const previousNode = elementRefs.current[lastFocusedIndex.current]
      if (previousNode) {
        previousNode.setAttribute('aria-selected', 'false')
      }
    }

    // No item focused
    if (focusedIndex === null) {
      lastFocusedIndex.current = null
      return
    }

    // Focused index out of bounds
    if (focusedIndex < 0 || focusedIndex >= entitiesLength) {
      lastFocusedIndex.current = null
      return
    }

    // Expand list if callback provided (for collapsible multi-list views)
    if (onExpand) {
      onExpand()
    }

    const node = elementRefs.current[focusedIndex]
    if (!node) {
      lastFocusedIndex.current = null
      return
    }

    // Set aria-selected to trigger CSS styling
    node.setAttribute('aria-selected', 'true')

    // Scroll into view if needed (only on focus change)
    if (lastFocusedIndex.current !== focusedIndex) {
      const scrollContainer = node.closest('[data-task-scroll-container]') as HTMLElement | null
      if (scrollContainer) {
        const nodeRect = node.getBoundingClientRect()
        const containerRect = scrollContainer.getBoundingClientRect()
        const isAbove = nodeRect.top < containerRect.top
        const isBelow = nodeRect.bottom > containerRect.bottom
        if (isAbove || isBelow) {
          node.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        }
      } else if (typeof node.scrollIntoView === 'function') {
        node.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }
    }

    lastFocusedIndex.current = focusedIndex
  }, [focusedIndex, entitiesLength, elementRefs, onExpand])
}
