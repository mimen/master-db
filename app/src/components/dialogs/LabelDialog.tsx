import { useQuery } from 'convex/react'
import { Tag } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { api } from '@/convex/_generated/api'
import { getProjectColor } from '@/lib/colors'
import { cn, parseMarkdownLinks } from '@/lib/utils'
import type { TodoistTask, TodoistLabelDoc } from '@/types/convex/todoist'

interface LabelDialogProps {
  task: TodoistTask | null
  onSelect: (labels: string[]) => void
  onClose: () => void
}

export function LabelDialog({ task, onSelect, onClose }: LabelDialogProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedLabels, setSelectedLabels] = useState<string[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const selectedLabelRef = useRef<HTMLButtonElement>(null)

  const labels = useQuery(api.todoist.publicQueries.getLabels)

  const filteredLabels = (labels || []).filter((label: TodoistLabelDoc) =>
    label.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  useEffect(() => {
    if (task) {
      setSearchTerm('')
      setSelectedLabels(task.labels)
      setSelectedIndex(0)
      setTimeout(() => searchInputRef.current?.focus(), 100)
    }
  }, [task])

  useEffect(() => {
    if (selectedIndex >= filteredLabels.length) {
      setSelectedIndex(Math.max(0, filteredLabels.length - 1))
    }
  }, [filteredLabels.length, selectedIndex])

  useEffect(() => {
    selectedLabelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [selectedIndex])

  const toggleLabel = (labelName: string) => {
    const newLabels = selectedLabels.includes(labelName)
      ? selectedLabels.filter(l => l !== labelName)
      : [...selectedLabels, labelName]

    setSelectedLabels(newLabels)
    onSelect(newLabels)
  }

  if (!task) return null

  return (
    <Dialog open={!!task} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-lg max-h-[80vh] flex flex-col p-0"
        onKeyDown={(e) => {
          switch (e.key) {
            case 'ArrowDown':
              e.preventDefault()
              setSelectedIndex(prev => Math.min(prev + 1, filteredLabels.length - 1))
              break
            case 'ArrowUp':
              e.preventDefault()
              setSelectedIndex(prev => Math.max(prev - 1, 0))
              break
            case 'Enter':
            case ' ':
              e.preventDefault()
              if (filteredLabels[selectedIndex]) {
                toggleLabel(filteredLabels[selectedIndex].name)
              }
              break
          }
        }}
      >
        <DialogHeader className="p-6 pb-4 space-y-3">
          <DialogTitle className="flex items-center gap-3">
            <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">@</span>
            </div>
            <div className="flex-1">
              <div>Select Labels</div>
              <div className="text-sm text-green-700 font-normal mt-1">
                {selectedLabels.length} label{selectedLabels.length !== 1 ? 's' : ''} selected
              </div>
            </div>
          </DialogTitle>
          <DialogDescription className="text-sm font-medium text-green-900 leading-tight">
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
                    className="text-green-700 hover:text-green-800 underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {segment.content}
                  </a>
                )
              }
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-4 border-b border-gray-200">
          <input
            ref={searchInputRef}
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 focus:border-transparent text-gray-900"
            placeholder="Search labels..."
          />
          <div className="mt-2 text-sm text-gray-500">
            ↑↓ to navigate • Enter/Space to toggle • ESC to close
          </div>
        </div>

        {selectedLabels.length > 0 && (
          <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
            <div className="flex flex-wrap gap-2">
              {selectedLabels.map((labelName) => {
                const label = labels?.find((l: TodoistLabelDoc) => l.name === labelName)
                const labelColor = label ? getProjectColor(label.color) : '#299fe6'
                return (
                  <span
                    key={labelName}
                    className="text-xs px-2 py-1 rounded-full flex items-center space-x-1"
                    style={{ backgroundColor: `${labelColor}20`, color: labelColor }}
                  >
                    <Tag className="w-3 h-3" style={{ color: labelColor }} />
                    <span>{labelName}</span>
                    <button
                      onClick={() => toggleLabel(labelName)}
                      className="ml-1 hover:scale-125 transition-transform"
                    >
                      ×
                    </button>
                  </span>
                )
              })}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {filteredLabels.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              {searchTerm ? `No labels found for "${searchTerm}"` : 'No labels available'}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredLabels.map((label: TodoistLabelDoc, index: number) => {
                const isSelected = index === selectedIndex
                const isChecked = selectedLabels.includes(label.name)
                const labelColor = getProjectColor(label.color)

                return (
                  <button
                    key={label.todoist_id}
                    ref={isSelected ? selectedLabelRef : null}
                    onClick={() => toggleLabel(label.name)}
                    className={cn(
                      'w-full text-left p-3 rounded-md transition-all duration-150 flex items-center space-x-3 border',
                      isSelected
                        ? 'bg-green-50 border-green-300'
                        : isChecked
                        ? 'bg-gray-50 border-gray-200'
                        : 'hover:bg-gray-50 border-transparent'
                    )}
                  >
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}}
                        className="w-4 h-4 rounded focus:ring-green-500"
                        style={{ accentColor: labelColor }}
                      />
                    </div>
                    <Tag className="w-4 h-4" style={{ color: labelColor }} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-gray-900">{label.name}</div>
                    </div>
                    {isSelected && <div className="text-xs font-bold text-green-500">↵</div>}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
