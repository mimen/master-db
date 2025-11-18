import { useEffect } from 'react'

import { useDialogContext } from '@/contexts/DialogContext'
import type { Doc } from '@/convex/_generated/dataModel'

/**
 * Keyboard shortcuts for routine property editing
 *
 * - Enter: Start editing name
 * - Shift+Enter: Start editing description
 * - p: Open priority dialog
 * - #: Open project dialog
 * - @: Open labels dialog
 */
export function useRoutineDialogShortcuts(focusedRoutine: Doc<"routines"> | null) {
  const { openPriority, openProject, openLabel } = useDialogContext()

  useEffect(() => {
    if (!focusedRoutine) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      const target = e.target

      // Don't trigger in input fields
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return
      }

      switch (e.key) {
        case 'Enter':
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault()
            // Find the routine row element and call its startEditing function
            const routineElement = document.querySelector(`[data-routine-id="${focusedRoutine._id}"]`) as HTMLElement & { startEditing?: () => void; startEditingDescription?: () => void }
            if (e.shiftKey) {
              // Shift+Enter: Start editing description
              if (routineElement?.startEditingDescription) {
                routineElement.startEditingDescription()
              }
            } else {
              // Enter: Start editing name
              if (routineElement?.startEditing) {
                routineElement.startEditing()
              }
            }
          }
          break
        case 'p':
          if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
            e.preventDefault()
            openPriority(focusedRoutine)
          }
          break
        case '#':
          if (e.shiftKey) {
            e.preventDefault()
            openProject(focusedRoutine)
          }
          break
        case '@':
          if (e.shiftKey) {
            e.preventDefault()
            openLabel(focusedRoutine)
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [focusedRoutine, openPriority, openProject, openLabel])
}

