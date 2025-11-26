import { Flag } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { Doc } from '@/convex/_generated/dataModel'
import { usePriority } from '@/lib/priorities'
import { cn } from '@/lib/utils'
import type { TodoistTask, TodoistProjectWithMetadata } from '@/types/convex/todoist'

interface PriorityDialogProps {
  task: TodoistTask | null
  project: TodoistProjectWithMetadata | null
  routine?: Doc<"routines"> | null
  onSelect: (priority: number) => void
  onClose: () => void
}

const priorities = [
  { value: 4, label: 'P1', name: 'Urgent', color: 'text-red-500', bgColor: 'bg-red-500' },
  { value: 3, label: 'P2', name: 'High', color: 'text-orange-500', bgColor: 'bg-orange-500' },
  { value: 2, label: 'P3', name: 'Medium', color: 'text-blue-500', bgColor: 'bg-blue-500' },
  { value: 1, label: 'P4', name: 'Normal', color: 'text-gray-500', bgColor: 'bg-gray-500' },
]

export function PriorityDialog({ task, project, routine, onSelect, onClose }: PriorityDialogProps) {
  const [focusedIndex, setFocusedIndex] = useState(0)
  const item = task || project || routine
  const itemPriority = task?.priority || project?.metadata?.priority || routine?.priority || 1
  const currentPriority = usePriority(itemPriority)

  useEffect(() => {
    if (item) {
      setFocusedIndex(priorities.findIndex(p => p.value === itemPriority) || 0)
    }
  }, [item, itemPriority])

  if (!item) return null

  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-lg"
        onKeyDown={(e) => {
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
        }}
      >
        <DialogHeader className="text-center">
          <DialogTitle className="text-2xl">Set Priority</DialogTitle>
          <DialogDescription>
            Use arrow keys and Enter, or press 1-4
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          {priorities.map((priority, index) => {
            const isSelected = itemPriority === priority.value
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

        <div className="mt-4 text-center text-sm text-gray-500">
          Current: <span className="font-semibold">{currentPriority?.displayName}</span> • ESC to cancel
        </div>
      </DialogContent>
    </Dialog>
  )
}
