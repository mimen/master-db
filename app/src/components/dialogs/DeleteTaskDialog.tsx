import { Trash2 } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { parseMarkdownLinks } from '@/lib/utils'
import type { TodoistTask } from '@/types/convex/todoist'

interface DeleteTaskDialogProps {
  task: TodoistTask | null
  onConfirm: () => void
  onClose: () => void
}

export function DeleteTaskDialog({ task, onConfirm, onClose }: DeleteTaskDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || !task) return

    dialog.showModal()

    const handleCancel = (e: Event) => {
      e.preventDefault()
      onClose()
    }

    dialog.addEventListener('cancel', handleCancel)
    return () => dialog.removeEventListener('cancel', handleCancel)
  }, [task, onClose])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || !task) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') {
        e.stopPropagation()
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        onConfirm()
      }
    }

    dialog.addEventListener('keydown', handleKeyDown)
    return () => dialog.removeEventListener('keydown', handleKeyDown)
  }, [task, onConfirm])

  if (!task) return null

  return (
    <dialog
      ref={dialogRef}
      className="backdrop:bg-black/75 bg-white rounded-2xl shadow-2xl max-w-md w-full p-0"
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          onClose()
        }
      }}
    >
      <div className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
            <Trash2 className="h-6 w-6 text-red-600" />
          </div>
          <h3 className="text-lg font-bold text-gray-900">Delete Task?</h3>
        </div>

        <p className="text-gray-600 mb-4">
          This will permanently delete the task. This action cannot be undone.
        </p>

        <div className="p-3 bg-gray-50 rounded-lg mb-6">
          <p className="text-sm font-medium text-gray-800">
            {parseMarkdownLinks(task.content).map((segment, index) => {
              if (segment.type === 'text') {
                return <span key={index}>{segment.content}</span>
              } else {
                return (
                  <a
                    key={index}
                    href={segment.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {segment.content}
                  </a>
                )
              }
            })}
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 px-4 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel (ESC)
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2 px-4 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors font-medium"
          >
            Delete (Enter)
          </button>
        </div>
      </div>
    </dialog>
  )
}
