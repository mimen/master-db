import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Inline Editing Hook for List Items
 *
 * Manages inline editing state for list items with primary and optional secondary fields.
 * Extracts the common editing pattern used across Tasks, Projects, and Routines.
 *
 * Features:
 * - Primary field editing (e.g., task content, project name, routine name)
 * - Optional secondary field editing (e.g., description)
 * - Keyboard navigation (Enter to save, Escape to cancel, Tab to switch fields)
 * - Input refs for focus management
 * - Expose edit functions to parent via DOM element data attribute
 *
 * @example
 * ```tsx
 * function TaskRow({ task }: TaskRowProps) {
 *   const editing = useListItemEditing({
 *     entity: task,
 *     entityId: task.todoist_id,
 *     fields: {
 *       primary: { value: task.content, key: 'content' },
 *       secondary: { value: task.description, key: 'description' }
 *     },
 *     onSave: async (changes) => {
 *       await updateTask(task.todoist_id, changes)
 *     }
 *   })
 *
 *   return (
 *     <div data-task-id={task.todoist_id}>
 *       {editing.isEditing ? (
 *         <>
 *           <input
 *             ref={editing.primaryInputRef}
 *             value={editing.primaryValue}
 *             onChange={(e) => editing.setPrimaryValue(e.target.value)}
 *             onKeyDown={editing.handlePrimaryKeyDown}
 *           />
 *           {editing.showSecondaryInput && (
 *             <input
 *               ref={editing.secondaryInputRef}
 *               value={editing.secondaryValue}
 *               onChange={(e) => editing.setSecondaryValue(e.target.value)}
 *               onKeyDown={editing.handleSecondaryKeyDown}
 *             />
 *           )}
 *         </>
 *       ) : (
 *         <>
 *           <div>{task.content}</div>
 *           {task.description && <div>{task.description}</div>}
 *         </>
 *       )}
 *     </div>
 *   )
 * }
 * ```
 */

interface Field {
  /**
   * Current value of the field from entity
   */
  value: string | undefined

  /**
   * Key name for this field (e.g., 'content', 'name', 'description')
   * Used in the changes object passed to onSave
   */
  key: string
}

interface UseListItemEditingOptions {
  /**
   * Unique identifier for the entity (used for DOM element lookup)
   */
  entityId: string

  /**
   * Field definitions
   */
  fields: {
    /**
     * Primary field (e.g., task content, project name)
     * Always shown when editing
     */
    primary: Field

    /**
     * Secondary field (e.g., description)
     * Optional - only shown if entity has value OR user tabs to it
     */
    secondary?: Field
  }

  /**
   * Callback when user saves changes
   * Receives object with changed fields only
   */
  onSave: (changes: Record<string, string>) => Promise<void>

  /**
   * Optional: Disable editing
   */
  disabled?: boolean
}

interface UseListItemEditingReturn {
  // State
  isEditing: boolean
  showSecondaryInput: boolean
  primaryValue: string
  secondaryValue: string

  // Setters
  setPrimaryValue: (value: string) => void
  setSecondaryValue: (value: string) => void

  // Actions
  startEditing: () => void
  startEditingSecondary: () => void
  cancelEditing: () => void
  saveEditing: () => Promise<void>

  // Refs
  primaryInputRef: React.RefObject<HTMLInputElement>
  secondaryInputRef: React.RefObject<HTMLInputElement>

  // Keyboard handlers
  handlePrimaryKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  handleSecondaryKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
}

/**
 * Hook that manages inline editing state for list items
 *
 * Handles primary and optional secondary field editing with keyboard navigation.
 * Exposes startEditing and startEditingSecondary functions via DOM element for
 * keyboard shortcuts to trigger.
 *
 * @param options Editing configuration
 * @returns Editing state and handlers
 */
export function useListItemEditing({
  entityId,
  fields,
  onSave,
  disabled = false
}: UseListItemEditingOptions): UseListItemEditingReturn {
  const [isEditing, setIsEditing] = useState(false)
  const [showSecondaryInput, setShowSecondaryInput] = useState(false)
  const [primaryValue, setPrimaryValue] = useState(fields.primary.value || '')
  const [secondaryValue, setSecondaryValue] = useState(fields.secondary?.value || '')

  const primaryInputRef = useRef<HTMLInputElement>(null)
  const secondaryInputRef = useRef<HTMLInputElement>(null)

  // Start editing primary field
  const startEditing = useCallback(() => {
    if (disabled) return
    setIsEditing(true)
    // Only show secondary input if entity already has secondary value
    setShowSecondaryInput(!!fields.secondary?.value)
    // Use real DB values when entering edit mode, not optimistic ones
    setPrimaryValue(fields.primary.value || '')
    setSecondaryValue(fields.secondary?.value || '')
  }, [disabled, fields.primary.value, fields.secondary?.value])

  // Start editing secondary field (description)
  const startEditingSecondary = useCallback(() => {
    if (disabled) return
    setIsEditing(true)
    // Always show secondary input when explicitly editing it
    setShowSecondaryInput(true)
    // Use real DB values when entering edit mode
    setPrimaryValue(fields.primary.value || '')
    setSecondaryValue(fields.secondary?.value || '')
    // Focus secondary input after state update
    setTimeout(() => {
      secondaryInputRef.current?.focus()
    }, 0)
  }, [disabled, fields.primary.value, fields.secondary?.value])

  // Cancel editing
  const cancelEditing = useCallback(() => {
    setIsEditing(false)
    setShowSecondaryInput(false)
    setPrimaryValue(fields.primary.value || '')
    setSecondaryValue(fields.secondary?.value || '')
  }, [fields.primary.value, fields.secondary?.value])

  // Save changes
  const saveEditing = useCallback(async () => {
    const hasPrimaryChanged = primaryValue !== (fields.primary.value || '')
    const hasSecondaryChanged = fields.secondary && secondaryValue !== (fields.secondary.value || '')

    if (!hasPrimaryChanged && !hasSecondaryChanged) {
      setIsEditing(false)
      return
    }

    // Exit edit mode - optimistic values will show immediately
    setIsEditing(false)
    setShowSecondaryInput(false)

    // Fire optimistic update (instant UI + background API call)
    const changes: Record<string, string> = {}
    if (hasPrimaryChanged) changes[fields.primary.key] = primaryValue
    if (hasSecondaryChanged && fields.secondary) {
      changes[fields.secondary.key] = secondaryValue
    }

    await onSave(changes)
  }, [primaryValue, secondaryValue, fields, onSave])

  // Keyboard handler for primary input
  const handlePrimaryKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void saveEditing()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelEditing()
    } else if (e.key === 'Tab' && !e.shiftKey && fields.secondary) {
      e.preventDefault()
      if (!showSecondaryInput) {
        setShowSecondaryInput(true)
        setTimeout(() => {
          secondaryInputRef.current?.focus()
        }, 0)
      } else {
        secondaryInputRef.current?.focus()
      }
    }
  }, [saveEditing, cancelEditing, showSecondaryInput, fields.secondary])

  // Keyboard handler for secondary input
  const handleSecondaryKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void saveEditing()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelEditing()
    } else if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      primaryInputRef.current?.focus()
    }
  }, [saveEditing, cancelEditing])

  // Focus primary input when entering edit mode
  useEffect(() => {
    if (isEditing && primaryInputRef.current) {
      primaryInputRef.current.focus()
      primaryInputRef.current.select()
    }
  }, [isEditing])

  // Expose editing functions to parent via DOM element (for keyboard shortcuts)
  useEffect(() => {
    const element = document.querySelector(`[data-entity-id="${entityId}"]`) as HTMLElement & {
      startEditing?: () => void
      startEditingDescription?: () => void
    }
    if (element) {
      element.startEditing = startEditing
      element.startEditingDescription = startEditingSecondary
    }
  }, [entityId, startEditing, startEditingSecondary])

  return {
    // State
    isEditing,
    showSecondaryInput,
    primaryValue,
    secondaryValue,

    // Setters
    setPrimaryValue,
    setSecondaryValue,

    // Actions
    startEditing,
    startEditingSecondary,
    cancelEditing,
    saveEditing,

    // Refs
    primaryInputRef,
    secondaryInputRef,

    // Keyboard handlers
    handlePrimaryKeyDown,
    handleSecondaryKeyDown
  }
}
