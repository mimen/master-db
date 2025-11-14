import { useContext, useEffect } from 'react'

import { useDialogContext } from '@/contexts/DialogContext'
import { GlobalHotkeysContext } from '@/contexts/GlobalHotkeysContext'
import type { TodoistTask } from '@/types/convex/todoist'

export function useTaskDialogShortcuts(focusedTask: TodoistTask | null) {
  const { openPriority, openProject, openLabel, openDueDate, openDeadline, openComplete, openDelete } = useDialogContext()
  const hotkeys = useContext(GlobalHotkeysContext)

  useEffect(() => {
    if (!focusedTask || !hotkeys) return

    const unregister = hotkeys.registerScope({
      id: 'task-shortcuts',
      handlers: {
        'Enter': (e) => {
          if (!e.metaKey && !e.ctrlKey) {
            // Find the task row element and call its startEditing function
            const taskElement = document.querySelector(`[data-task-id="${focusedTask.todoist_id}"]`) as HTMLElement & { startEditing?: () => void; startEditingDescription?: () => void }
            if (e.shiftKey) {
              // Shift+Enter: Start editing description
              if (taskElement?.startEditingDescription) {
                taskElement.startEditingDescription()
                return true
              }
            } else {
              // Enter: Start editing content
              if (taskElement?.startEditing) {
                taskElement.startEditing()
                return true
              }
            }
          }
          return false
        },
        'p': () => {
          openPriority(focusedTask)
          return true
        },
        'shift+#': () => {
          openProject(focusedTask)
          return true
        },
        'shift+@': () => {
          openLabel(focusedTask)
          return true
        },
        's': () => {
          openDueDate(focusedTask)
          return true
        },
        'shift+D': () => {
          openDeadline(focusedTask)
          return true
        },
        'c': () => {
          openComplete(focusedTask)
          return true
        },
        'Delete': () => {
          openDelete(focusedTask)
          return true
        },
        'Backspace': () => {
          openDelete(focusedTask)
          return true
        },
      },
      priority: 20, // Higher priority than layout navigation
      isActive: () => {
        // Only active when not editing text
        const target = document.activeElement
        return !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable)
      },
    })

    return unregister
  }, [focusedTask, openPriority, openProject, openLabel, openDueDate, openDeadline, openComplete, openDelete, hotkeys])
}
