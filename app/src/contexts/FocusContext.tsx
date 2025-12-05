/**
 * Focus Context
 *
 * Tracks which entity (task, project, or routine) is currently focused/selected in the UI.
 * This is used to enable context-aware keyboard shortcuts.
 *
 * Simplified single-focus design - only ONE entity can be focused at a time.
 */

import type { ReactNode } from 'react'
import { createContext, useContext, useState, useCallback } from 'react'

interface FocusContextValue {
  /**
   * ID of currently focused entity (null if nothing focused)
   */
  focusedEntityId: string | null

  /**
   * Type of currently focused entity (null if nothing focused)
   */
  focusedEntityType: 'task' | 'project' | 'routine' | null

  /**
   * Update focused entity
   * @param id Entity ID (null to clear focus)
   * @param type Entity type (required when id is non-null)
   */
  setFocusedEntity: (id: string | null, type?: 'task' | 'project' | 'routine') => void
}

const FocusContext = createContext<FocusContextValue | undefined>(undefined)

export function FocusProvider({ children }: { children: ReactNode }) {
  const [focusedEntityId, setFocusedEntityId] = useState<string | null>(null)
  const [focusedEntityType, setFocusedEntityType] = useState<'task' | 'project' | 'routine' | null>(null)

  const setFocusedEntity = useCallback((id: string | null, type?: 'task' | 'project' | 'routine') => {
    if (id === null) {
      setFocusedEntityId(null)
      setFocusedEntityType(null)
    } else {
      if (!type) {
        throw new Error('setFocusedEntity: type is required when id is non-null')
      }
      setFocusedEntityId(id)
      setFocusedEntityType(type)
    }
  }, [])

  return (
    <FocusContext.Provider
      value={{
        focusedEntityId,
        focusedEntityType,
        setFocusedEntity,
      }}
    >
      {children}
    </FocusContext.Provider>
  )
}

export function useFocusContext() {
  const context = useContext(FocusContext)
  if (!context) {
    throw new Error('useFocusContext must be used within FocusProvider')
  }
  return context
}
