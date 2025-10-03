import { Calendar } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { cn, parseMarkdownLinks } from '@/lib/utils'
import type { TodoistTask } from '@/types/convex/todoist'

interface DueDateDialogProps {
  task: TodoistTask | null
  onSelect: (dueString: string) => void
  onClose: () => void
}

interface DateOption {
  id: string
  label: string
  sublabel: string
  dueString: string
  icon: string
}

export function DueDateDialog({ task, onSelect, onClose }: DueDateDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [searchTerm, setSearchTerm] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const selectedOptionRef = useRef<HTMLButtonElement>(null)

  const dateOptions: DateOption[] = [
    { id: 'today', label: 'Today', sublabel: 'Due today', dueString: 'today', icon: '📅' },
    { id: 'tomorrow', label: 'Tomorrow', sublabel: 'Due tomorrow', dueString: 'tomorrow', icon: '➡️' },
    { id: 'this-weekend', label: 'This weekend', sublabel: 'Saturday', dueString: 'Saturday', icon: '🏠' },
    { id: 'next-week', label: 'Next week', sublabel: 'Monday', dueString: 'next Monday', icon: '📆' },
    { id: 'next-weekend', label: 'Next weekend', sublabel: 'Next Saturday', dueString: 'next Saturday', icon: '🎯' },
    { id: 'in-1-week', label: 'In 1 week', sublabel: '7 days from now', dueString: 'in 7 days', icon: '📊' },
    { id: 'in-2-weeks', label: 'In 2 weeks', sublabel: '14 days from now', dueString: 'in 14 days', icon: '📈' },
    { id: 'in-1-month', label: 'In 1 month', sublabel: '30 days from now', dueString: 'in 30 days', icon: '🗓️' },
    { id: 'no-date', label: 'No date', sublabel: 'Remove due date', dueString: 'no date', icon: '🚫' },
  ]

  const filteredOptions = searchTerm
    ? dateOptions.filter(opt =>
        opt.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
        opt.sublabel.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : dateOptions

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || !task) return

    dialog.showModal()
    setSearchTerm('')
    setSelectedIndex(0)

    setTimeout(() => searchInputRef.current?.focus(), 100)

    const handleCancel = (e: Event) => {
      e.preventDefault()
      onClose()
    }

    dialog.addEventListener('cancel', handleCancel)
    return () => dialog.removeEventListener('cancel', handleCancel)
  }, [task, onClose])

  useEffect(() => {
    if (selectedIndex >= filteredOptions.length) {
      setSelectedIndex(Math.max(0, filteredOptions.length - 1))
    }
  }, [filteredOptions.length, selectedIndex])

  useEffect(() => {
    selectedOptionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [selectedIndex])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || !task) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') {
        e.stopPropagation()
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex(prev => Math.min(prev + 1, filteredOptions.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(prev => Math.max(prev - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (filteredOptions[selectedIndex]) {
            onSelect(filteredOptions[selectedIndex].dueString)
          }
          break
      }
    }

    dialog.addEventListener('keydown', handleKeyDown)
    return () => dialog.removeEventListener('keydown', handleKeyDown)
  }, [task, onSelect, filteredOptions, selectedIndex])

  if (!task) return null

  return (
    <dialog
      ref={dialogRef}
      className="backdrop:bg-black/75 bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[80vh] flex flex-col p-0"
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          onClose()
        }
      }}
    >
      <div className="p-6 border-b border-gray-200 bg-purple-50 rounded-t-2xl">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center">
            <Calendar className="h-4 w-4 text-white" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-purple-900">Set Due Date</h2>
          </div>
        </div>
        <h3 className="text-sm font-medium text-purple-900 leading-tight">
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
                  className="text-purple-700 hover:text-purple-800 underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {segment.content}
                </a>
              )
            }
          })}
        </h3>
      </div>

      <div className="p-6 border-b border-gray-200">
        <input
          ref={searchInputRef}
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
          placeholder="Type a date or search options..."
        />
        <div className="mt-2 text-sm text-gray-500">
          ↑↓ to navigate • Enter to select • ESC to cancel
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {filteredOptions.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No matching date options
          </div>
        ) : (
          <div className="space-y-1">
            {filteredOptions.map((option, index) => {
              const isSelected = index === selectedIndex

              return (
                <button
                  key={option.id}
                  ref={isSelected ? selectedOptionRef : null}
                  onClick={() => onSelect(option.dueString)}
                  className={cn(
                    'w-full text-left p-3 rounded-md transition-all duration-150 flex items-center gap-3 border',
                    isSelected
                      ? 'bg-purple-50 border-purple-300'
                      : 'hover:bg-gray-50 border-transparent'
                  )}
                >
                  <span className="text-2xl">{option.icon}</span>
                  <div className="flex-1">
                    <div className="font-medium text-sm text-gray-900">{option.label}</div>
                    <div className="text-xs text-gray-500">{option.sublabel}</div>
                  </div>
                  {isSelected && <span className="text-xs text-purple-500 font-bold">↵</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {task.due && (
        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <div className="text-xs text-gray-600">
            Current due date: <span className="font-semibold">{task.due.string || task.due.date}</span>
          </div>
        </div>
      )}
    </dialog>
  )
}
