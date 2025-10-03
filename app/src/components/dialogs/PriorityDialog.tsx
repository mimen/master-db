import { useEffect, useRef, useState } from 'react'
import { Flag } from 'lucide-react'

import { usePriority } from '@/lib/priorities'
import { cn } from '@/lib/utils'
import type { TodoistTask } from '@/types/convex/todoist'

interface PriorityDialogProps {
  task: TodoistTask | null
  onSelect: (priority: number) => void
  onClose: () => void
}

export function PriorityDialog({ task, onSelect, onClose }: PriorityDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [focusedIndex, setFocusedIndex] = useState(0)

  const priorities = [
    { value: 4, label: 'P1', name: 'Urgent', color: 'text-red-500', bgColor: 'bg-red-500' },
    { value: 3, label: 'P2', name: 'High', color: 'text-orange-500', bgColor: 'bg-orange-500' },
    { value: 2, label: 'P3', name: 'Medium', color: 'text-blue-500', bgColor: 'bg-blue-500' },
    { value: 1, label: 'P4', name: 'Normal', color: 'text-gray-500', bgColor: 'bg-gray-500' },
  ]

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || !task) return

    dialog.showModal()
    setFocusedIndex(priorities.findIndex(p => p.value === task.priority) || 0)

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

      switch (e.key) {
        case '1':
          e.preventDefault()
          onSelect(4)
          break
        case '2':
          e.preventDefault()
          onSelect(3)
          break
        case '3':
          e.preventDefault()
          onSelect(2)
          break
        case '4':
          e.preventDefault()
          onSelect(1)
          break
        case 'ArrowUp':
        case 'ArrowLeft':
          e.preventDefault()
          setFocusedIndex(prev => Math.max(0, prev - 1))
          break
        case 'ArrowDown':
        case 'ArrowRight':
          e.preventDefault()
          setFocusedIndex(prev => Math.min(priorities.length - 1, prev + 1))
          break
        case 'Enter':
        case ' ':
          e.preventDefault()
          onSelect(priorities[focusedIndex].value)
          break
      }
    }

    dialog.addEventListener('keydown', handleKeyDown)
    return () => dialog.removeEventListener('keydown', handleKeyDown)
  }, [task, onSelect, focusedIndex])

  const currentPriority = usePriority(task?.priority || 1)

  if (!task) return null

  return (
    <dialog
      ref={dialogRef}
      className="backdrop:bg-black/75 bg-white rounded-2xl p-8 shadow-2xl max-w-lg w-full"
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          onClose()
        }
      }}
    >
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Set Priority</h2>
        <p className="text-gray-600 mb-8">Use arrow keys and Enter, or press 1-4</p>

        <div className="grid grid-cols-2 gap-4">
          {priorities.map((priority, index) => {
            const isSelected = task.priority === priority.value
            const isFocused = focusedIndex === index

            return (
              <button
                key={priority.value}
                onClick={() => onSelect(priority.value)}
                className={cn(
                  'p-6 rounded-xl border-2 font-bold text-lg transition-all duration-200 transform',
                  isSelected
                    ? `${priority.bgColor} text-white scale-105 shadow-lg`
                    : isFocused
                    ? 'bg-gray-200 border-gray-400 text-gray-800 scale-102 shadow-md'
                    : 'bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200 hover:scale-102',
                  isFocused && 'ring-2 ring-blue-500 ring-offset-2'
                )}
              >
                <div className="flex items-center justify-center mb-2">
                  <Flag
                    className={cn('h-8 w-8', isSelected ? 'text-white' : priority.color)}
                    fill="currentColor"
                  />
                </div>
                <div className="text-3xl font-black mb-2">{priority.label}</div>
                <div className="text-sm opacity-90">{priority.name}</div>
                <div className="text-xs mt-2 opacity-75">Press {priority.label.substring(1)}</div>
              </button>
            )
          })}
        </div>

        <div className="mt-8 text-sm text-gray-500">
          Current: <span className="font-semibold">{currentPriority?.displayName}</span> • ESC to cancel
        </div>
      </div>
    </dialog>
  )
}
