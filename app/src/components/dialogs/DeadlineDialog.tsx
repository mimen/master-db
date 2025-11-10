import { AlertCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn, parseMarkdownLinks } from '@/lib/utils'
import type { TodoistTask } from '@/types/convex/todoist'

interface DeadlineDialogProps {
  task: TodoistTask | null
  onSelect: (deadlineDate: string) => void
  onClose: () => void
}

interface DeadlineOption {
  id: string
  label: string
  sublabel: string
  deadlineDate: string
  icon: string
}

const getDateString = (daysFromNow: number): string => {
  const date = new Date()
  date.setDate(date.getDate() + daysFromNow)
  return date.toISOString().split('T')[0]
}

const getNextFriday = (): string => {
  const today = new Date()
  const dayOfWeek = today.getDay()
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7 || 7
  const friday = new Date(today)
  friday.setDate(today.getDate() + daysUntilFriday)
  return friday.toISOString().split('T')[0]
}

const deadlineOptions: DeadlineOption[] = [
  { id: 'tomorrow', label: 'Tomorrow', sublabel: 'Deadline tomorrow', deadlineDate: getDateString(1), icon: '⏰' },
  { id: 'in-3-days', label: 'In 3 days', sublabel: '3 days from now', deadlineDate: getDateString(3), icon: '📅' },
  { id: 'end-of-week', label: 'End of week', sublabel: 'Friday', deadlineDate: getNextFriday(), icon: '📆' },
  { id: 'in-1-week', label: 'In 1 week', sublabel: '7 days from now', deadlineDate: getDateString(7), icon: '🗓️' },
  { id: 'in-2-weeks', label: 'In 2 weeks', sublabel: '14 days from now', deadlineDate: getDateString(14), icon: '📊' },
  { id: 'in-1-month', label: 'In 1 month', sublabel: '30 days from now', deadlineDate: getDateString(30), icon: '📈' },
  { id: 'no-deadline', label: 'No deadline', sublabel: 'Remove deadline', deadlineDate: 'no date', icon: '🚫' },
]

export function DeadlineDialog({ task, onSelect, onClose }: DeadlineDialogProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selectedOptionRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (task) {
      setSelectedIndex(0)
    }
  }, [task])

  useEffect(() => {
    selectedOptionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [selectedIndex])

  if (!task) return null

  return (
    <Dialog open={!!task} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-lg max-h-[80vh] flex flex-col p-0"
        onKeyDown={(e) => {
          switch (e.key) {
            case 'ArrowDown':
              e.preventDefault()
              setSelectedIndex(prev => Math.min(prev + 1, deadlineOptions.length - 1))
              break
            case 'ArrowUp':
              e.preventDefault()
              setSelectedIndex(prev => Math.max(prev - 1, 0))
              break
            case 'Enter':
              e.preventDefault()
              if (deadlineOptions[selectedIndex]) {
                onSelect(deadlineOptions[selectedIndex].deadlineDate)
              }
              break
          }
        }}
      >
        <DialogHeader className="p-6 pb-4 space-y-3">
          <DialogTitle className="flex items-center gap-3">
            <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center">
              <AlertCircle className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1">
              <div>Set Deadline</div>
              <div className="text-xs text-orange-700 font-normal mt-1">Hard deadline (different from due date)</div>
            </div>
          </DialogTitle>
          <DialogDescription className="text-sm font-medium text-orange-900 leading-tight">
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
                    className="text-orange-700 hover:text-orange-800 underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {segment.content}
                  </a>
                )
              }
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="p-4 border-b border-gray-200 bg-gray-50">
          <div className="text-sm text-gray-500">
            ↑↓ to navigate • Enter to select • ESC to cancel
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-1">
            {deadlineOptions.map((option, index) => {
              const isSelected = index === selectedIndex

              return (
                <button
                  key={option.id}
                  ref={isSelected ? selectedOptionRef : null}
                  onClick={() => onSelect(option.deadlineDate)}
                  className={cn(
                    'w-full text-left p-3 rounded-md transition-all duration-150 flex items-center gap-3 border',
                    isSelected
                      ? 'bg-orange-50 border-orange-300'
                      : 'hover:bg-gray-50 border-transparent'
                  )}
                >
                  <span className="text-2xl">{option.icon}</span>
                  <div className="flex-1">
                    <div className="font-medium text-sm text-gray-900">{option.label}</div>
                    <div className="text-xs text-gray-500">{option.sublabel}</div>
                  </div>
                  {isSelected && <span className="text-xs text-orange-500 font-bold">↵</span>}
                </button>
              )
            })}
          </div>
        </div>

        {task.deadline && (
          <div className="p-4 border-t border-gray-200 bg-gray-50">
            <div className="text-xs text-gray-600">
              Current deadline: <span className="font-semibold">{task.deadline.date}</span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
