import { useQuery } from 'convex/react'
import { format } from 'date-fns'
import { CalendarIcon, Plus, X } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/convex/_generated/api'
import { useTodoistAction } from '@/hooks/useTodoistAction'
import { cn } from '@/lib/utils'
import type { TodoistProject, TodoistLabel } from '@/types/convex/todoist'

interface QuickAddTaskDialogProps {
  isOpen: boolean
  onClose: () => void
  defaultProjectId?: string
}

export function QuickAddTaskDialog({ isOpen, onClose, defaultProjectId }: QuickAddTaskDialogProps) {
  const [content, setContent] = useState('')
  const [description, setDescription] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(defaultProjectId)
  const [selectedPriority, setSelectedPriority] = useState<number>(1) // API Priority 1 = P4 (normal)
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined)
  const [deadlineDate, setDeadlineDate] = useState<Date | undefined>(undefined)
  const [selectedLabels, setSelectedLabels] = useState<string[]>([])

  const [isDueDateOpen, setIsDueDateOpen] = useState(false)
  const [isDeadlineOpen, setIsDeadlineOpen] = useState(false)

  const contentInputRef = useRef<HTMLInputElement>(null)

  const projects = useQuery(api.todoist.queries.getProjects.getProjects)
  const labels = useQuery(api.todoist.queries.getLabels.getLabels)

  const createTask = useTodoistAction(
    api.todoist.actions.createTask.createTask,
    {
      loadingMessage: "Creating task...",
      successMessage: "Task created!",
      errorMessage: "Failed to create task"
    }
  )

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      setContent('')
      setDescription('')
      setSelectedProjectId(defaultProjectId)
      setSelectedPriority(1) // Reset to normal priority (P4)
      setDueDate(undefined)
      setDeadlineDate(undefined)
      setSelectedLabels([])
      setTimeout(() => contentInputRef.current?.focus(), 100)
    }
  }, [isOpen, defaultProjectId])

  const handleSubmit = useCallback(async () => {
    if (!content.trim()) {
      return
    }

    const args: {
      content: string
      projectId?: string
      priority?: number
      due?: { date: string }
      deadlineDate?: string
      labels?: string[]
      description?: string
    } = {
      content: content.trim(),
    }

    if (selectedProjectId) {
      args.projectId = selectedProjectId
    }

    if (selectedPriority !== 1) {
      args.priority = selectedPriority
    }

    if (dueDate) {
      args.due = { date: format(dueDate, 'yyyy-MM-dd') }
    }

    if (deadlineDate) {
      args.deadlineDate = format(deadlineDate, 'yyyy-MM-dd')
    }

    if (selectedLabels.length > 0) {
      args.labels = selectedLabels
    }

    if (description.trim()) {
      args.description = description.trim()
    }

    await createTask(args)
    onClose()
  }, [content, selectedProjectId, selectedPriority, dueDate, deadlineDate, selectedLabels, description, createTask, onClose])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  const toggleLabel = (labelName: string) => {
    setSelectedLabels(prev =>
      prev.includes(labelName)
        ? prev.filter(l => l !== labelName)
        : [...prev, labelName]
    )
  }

  const priorityOptions = [
    { api: 4, ui: 'P1', color: 'text-red-600', bgColor: 'bg-red-50', borderColor: 'border-red-300' },
    { api: 3, ui: 'P2', color: 'text-orange-600', bgColor: 'bg-orange-50', borderColor: 'border-orange-300' },
    { api: 2, ui: 'P3', color: 'text-blue-600', bgColor: 'bg-blue-50', borderColor: 'border-blue-300' },
    { api: 1, ui: 'P4', color: 'text-gray-600', bgColor: 'bg-gray-50', borderColor: 'border-gray-300' },
  ]

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] flex flex-col p-0"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader className="p-6 pb-4 border-b border-gray-200">
          <DialogTitle className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-green-500 to-green-600 rounded-full flex items-center justify-center">
              <Plus className="w-4 h-4 text-white" />
            </div>
            Quick Add Task
          </DialogTitle>
          <DialogDescription className="text-sm text-gray-500">
            Cmd+Enter to create • ESC to cancel • N to open
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Task Content */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Task <span className="text-red-500">*</span>
            </label>
            <Input
              ref={contentInputRef}
              type="text"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="What needs to be done?"
              className="w-full"
            />
          </div>

          {/* Project Selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Project
            </label>
            <select
              value={selectedProjectId || ''}
              onChange={(e) => setSelectedProjectId(e.target.value || undefined)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
            >
              <option value="">Inbox</option>
              {projects?.map((project: TodoistProject) => (
                <option key={project.todoist_id} value={project.todoist_id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>

          {/* Priority Selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Priority
            </label>
            <div className="grid grid-cols-4 gap-2">
              {priorityOptions.map((option) => {
                const isSelected = selectedPriority === option.api
                return (
                  <button
                    key={option.api}
                    onClick={() => setSelectedPriority(option.api)}
                    className={cn(
                      'px-4 py-2 rounded-md border-2 transition-all font-medium',
                      isSelected
                        ? `${option.bgColor} ${option.borderColor} ${option.color}`
                        : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                    )}
                  >
                    {option.ui}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Due Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Due Date
            </label>
            <Popover open={isDueDateOpen} onOpenChange={setIsDueDateOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'w-full justify-start text-left font-normal',
                    !dueDate && 'text-muted-foreground'
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dueDate ? format(dueDate, 'PPP') : 'Pick a date'}
                  {dueDate && (
                    <X
                      className="ml-auto h-4 w-4 hover:text-red-600"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDueDate(undefined)
                      }}
                    />
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={dueDate}
                  onSelect={(date) => {
                    setDueDate(date)
                    setIsDueDateOpen(false)
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Deadline Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Deadline
            </label>
            <Popover open={isDeadlineOpen} onOpenChange={setIsDeadlineOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'w-full justify-start text-left font-normal',
                    !deadlineDate && 'text-muted-foreground'
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {deadlineDate ? format(deadlineDate, 'PPP') : 'Pick a date'}
                  {deadlineDate && (
                    <X
                      className="ml-auto h-4 w-4 hover:text-red-600"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeadlineDate(undefined)
                      }}
                    />
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={deadlineDate}
                  onSelect={(date) => {
                    setDeadlineDate(date)
                    setIsDeadlineOpen(false)
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Labels Multi-select */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Labels
            </label>
            <div className="border border-gray-300 rounded-md p-3 min-h-[42px]">
              {selectedLabels.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {selectedLabels.map((labelName) => {
                    const label = labels?.find((l: TodoistLabel) => l.name === labelName)
                    return (
                      <span
                        key={labelName}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 text-sm rounded-md"
                      >
                        {label?.name || labelName}
                        <X
                          className="h-3 w-3 cursor-pointer hover:text-red-600"
                          onClick={() => toggleLabel(labelName)}
                        />
                      </span>
                    )
                  })}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {labels?.filter((l: TodoistLabel) => !selectedLabels.includes(l.name)).map((label: TodoistLabel) => (
                  <button
                    key={label.todoist_id}
                    onClick={() => toggleLabel(label.name)}
                    className="px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm rounded-md transition-colors"
                  >
                    {label.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Description
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add more details..."
              className="w-full min-h-[100px]"
            />
          </div>
        </div>

        <div className="p-6 pt-4 border-t border-gray-200 flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!content.trim()}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            <Plus className="w-4 h-4 mr-2" />
            Create Task
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
