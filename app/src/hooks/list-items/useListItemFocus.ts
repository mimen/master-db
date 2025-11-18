import { useEffect, useRef } from 'react'

/**
 * Focus Management Hook for List Items
 *
 * Manages focus highlighting, scrolling, and aria attributes for list items.
 * Extracts the common focus management pattern used across Tasks, Projects, and Routines.
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

const FOCUSED_CLASSNAMES = ['bg-accent/50', 'border-primary/30'] as const

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

  useEffect(() => {
    const removeHighlight = (element: HTMLDivElement | null) => {
      if (!element) return
      FOCUSED_CLASSNAMES.forEach((className) => element.classList.remove(className))
      element.setAttribute('aria-selected', 'false')
    }

    const applyHighlight = (element: HTMLDivElement | null) => {
      if (!element) return
      FOCUSED_CLASSNAMES.forEach((className) => element.classList.add(className))
      element.setAttribute('aria-selected', 'true')
    }

    // Remove highlight from previously focused item
    if (lastFocusedIndex.current !== null && lastFocusedIndex.current !== focusedIndex) {
      removeHighlight(elementRefs.current[lastFocusedIndex.current])
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

    // Apply highlight if not already applied or index changed
    if (
      lastFocusedIndex.current !== focusedIndex ||
      !node.classList.contains(FOCUSED_CLASSNAMES[0])
    ) {
      applyHighlight(node)
    }

    // Focus the DOM element
    if (typeof document !== 'undefined' && node !== document.activeElement) {
      node.focus({ preventScroll: true })
    }

    // Scroll into view if needed
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

    lastFocusedIndex.current = focusedIndex
  }, [focusedIndex, entitiesLength, elementRefs, onExpand])
}
