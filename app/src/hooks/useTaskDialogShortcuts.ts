import { useEffect } from 'react'

import { useDialogContext } from '@/contexts/DialogContext'
import type { TodoistTask } from '@/types/convex/todoist'

export function useTaskDialogShortcuts(focusedTask: TodoistTask | null) {
  const { openPriority, openProject, openLabel, openDueDate, openDeadline, openComplete, openDelete } = useDialogContext()

  useEffect(() => {
    if (!focusedTask) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      const target = e.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return
      }

      switch (e.key) {
        case 'p':
          if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
            e.preventDefault()
            openPriority(focusedTask)
          }
          break
        case '#':
          if (e.shiftKey) {
            e.preventDefault()
            openProject(focusedTask)
          }
          break
        case '@':
          if (e.shiftKey) {
            e.preventDefault()
            openLabel(focusedTask)
          }
          break
        case 's':
          if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
            e.preventDefault()
            openDueDate(focusedTask)
          }
          break
        case 'D':
          if (e.shiftKey) {
            e.preventDefault()
            openDeadline(focusedTask)
          }
          break
        case 'c':
          if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
            e.preventDefault()
            openComplete(focusedTask)
          }
          break
        case 'Delete':
        case 'Backspace':
          if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
            e.preventDefault()
            openDelete(focusedTask)
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [focusedTask, openPriority, openProject, openLabel, openDueDate, openDeadline, openComplete, openDelete])
}
