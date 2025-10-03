import { useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useQuery } from 'convex/react'

import { api } from '@/convex/_generated/api'
import { getProjectColor } from '@/lib/colors'
import { cn, parseMarkdownLinks } from '@/lib/utils'
import type { TodoistTask, TodoistProject } from '@/types/convex/todoist'

interface ProjectDialogProps {
  task: TodoistTask | null
  onSelect: (projectId: string) => void
  onClose: () => void
}

export function ProjectDialog({ task, onSelect, onClose }: ProjectDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const selectedProjectRef = useRef<HTMLButtonElement>(null)

  const projects = useQuery(api.todoist.publicQueries.getProjects)

  const buildProjectHierarchy = () => {
    if (!projects) return []

    const rootProjects = projects.filter((p: TodoistProject) => !p.parent_id)

    type ProjectWithLevel = TodoistProject & { level: number }
    const result: ProjectWithLevel[] = []

    const addProjectWithChildren = (project: TodoistProject, level: number) => {
      const matchesSearch = !searchTerm || project.name.toLowerCase().includes(searchTerm.toLowerCase())

      if (matchesSearch || !searchTerm) {
        result.push({ ...project, level })
      }

      const children = projects.filter((p: TodoistProject) => p.parent_id === project.todoist_id)
      children.forEach((child: TodoistProject) => addProjectWithChildren(child, level + 1))
    }

    rootProjects.forEach((project: TodoistProject) => addProjectWithChildren(project, 0))
    return result
  }

  const filteredProjects = buildProjectHierarchy()

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
    if (selectedIndex >= filteredProjects.length) {
      setSelectedIndex(Math.max(0, filteredProjects.length - 1))
    }
  }, [filteredProjects.length, selectedIndex])

  useEffect(() => {
    selectedProjectRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
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
          setSelectedIndex(prev => Math.min(prev + 1, filteredProjects.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(prev => Math.max(prev - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (filteredProjects[selectedIndex]) {
            onSelect(filteredProjects[selectedIndex].todoist_id)
          }
          break
      }
    }

    dialog.addEventListener('keydown', handleKeyDown)
    return () => dialog.removeEventListener('keydown', handleKeyDown)
  }, [task, onSelect, filteredProjects, selectedIndex])

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
      <div className="p-6 border-b border-gray-200 bg-blue-50 rounded-t-2xl">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">#</span>
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-blue-900">Select Project</h2>
          </div>
        </div>
        <h3 className="text-sm font-medium text-blue-900 leading-tight">
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
                  className="text-blue-700 hover:text-blue-800 underline"
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
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
          placeholder="Search projects..."
        />
        <div className="mt-2 text-sm text-gray-500">
          ↑↓ to navigate • Enter to select • ESC to cancel
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {filteredProjects.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {searchTerm ? `No projects found for "${searchTerm}"` : 'No projects available'}
          </div>
        ) : (
          <div className="space-y-1">
            {filteredProjects.map((project, index) => {
              const isSelected = index === selectedIndex
              const isCurrent = task.project_id === project.todoist_id

              return (
                <button
                  key={project.todoist_id}
                  ref={isSelected ? selectedProjectRef : null}
                  onClick={() => onSelect(project.todoist_id)}
                  className={cn(
                    'w-full text-left p-2.5 rounded-md transition-all duration-150 flex items-center gap-2 border',
                    isSelected
                      ? 'bg-blue-50 border-blue-300'
                      : isCurrent
                      ? 'bg-green-50 border-green-200'
                      : 'hover:bg-gray-50 border-transparent'
                  )}
                  style={{ paddingLeft: `${0.75 + project.level * 1.5}rem` }}
                >
                  {project.level > 0 && (
                    <ChevronRight className="h-3 w-3 text-gray-400" />
                  )}
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: getProjectColor(project.color) }}
                  />
                  <span className="text-gray-900 flex-1">{project.name}</span>
                  {isCurrent && (
                    <span className="text-xs text-green-600">✓ Current</span>
                  )}
                  {isSelected && (
                    <span className="text-xs text-blue-500 font-bold">↵</span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </dialog>
  )
}
