import { useEffect } from 'react'

import { useDialogContext } from '@/contexts/DialogContext'
import type { TodoistProjectWithMetadata } from '@/types/convex/todoist'

export function useProjectDialogShortcuts(focusedProject: TodoistProjectWithMetadata | null) {
  const { openPriority, openArchive } = useDialogContext()

  useEffect(() => {
    if (!focusedProject) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      const target = e.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return
      }

      switch (e.key) {
        case 'Enter':
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault()
            // Find the project row element and call its startEditing function
            const projectElement = document.querySelector(`[data-project-id="${focusedProject.todoist_id}"]`) as HTMLElement & { startEditing?: () => void; startEditingDescription?: () => void }
            if (e.shiftKey) {
              // Shift+Enter: Start editing description
              if (projectElement?.startEditingDescription) {
                projectElement.startEditingDescription()
              }
            } else {
              // Enter: Start editing name
              if (projectElement?.startEditing) {
                projectElement.startEditing()
              }
            }
          }
          break
        case 'p':
          if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
            e.preventDefault()
            openPriority(focusedProject)
          }
          break
        case 'e':
          if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
            e.preventDefault()
            openArchive(focusedProject)
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [focusedProject, openPriority, openArchive])
}
