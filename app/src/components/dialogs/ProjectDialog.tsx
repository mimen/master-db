import { useQuery } from 'convex/react'
import { ChevronRight, Plus } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { api } from '@/convex/_generated/api'
import { useCreateProject } from '@/hooks/useCreateProject'
import { getProjectColor, TODOIST_COLOR_OPTIONS } from '@/lib/colors'
import { cn, parseMarkdownLinks } from '@/lib/utils'
import type { TodoistProject, TodoistTask } from '@/types/convex/todoist'

interface ProjectDialogProps {
  task: TodoistTask | null
  onSelect: (projectId: string) => void
  onClose: () => void
}

export function ProjectDialog({ task, onSelect, onClose }: ProjectDialogProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const selectedProjectRef = useRef<HTMLButtonElement>(null)

  // Project creation state
  const [isCreatingProject, setIsCreatingProject] = useState(false)
  const [isSelectingParent, setIsSelectingParent] = useState(false)
  const [isSelectingColor, setIsSelectingColor] = useState(false)
  const [selectedParentId, setSelectedParentId] = useState<string | undefined>(undefined)
  const [selectedColor, setSelectedColor] = useState<string>('charcoal')
  const [parentSelectorIndex, setParentSelectorIndex] = useState(0)
  const [colorSelectorIndex, setColorSelectorIndex] = useState(17) // charcoal index
  const parentProjectRef = useRef<HTMLButtonElement>(null)
  const colorButtonRef = useRef<HTMLButtonElement>(null)

  const projects = useQuery(api.todoist.publicQueries.getProjects)
  const { createProject } = useCreateProject()

  // Helper to calculate project depth for parent selection
  const getProjectDepth = useCallback((projectId: string): number => {
    if (!projects) return 0
    let depth = 0
    let currentProject = projects.find((p: TodoistProject) => p.todoist_id === projectId)
    while (currentProject?.parent_id) {
      depth++
      currentProject = projects.find((p: TodoistProject) => p.todoist_id === currentProject!.parent_id)
    }
    return depth
  }, [projects])

  // Build parent options with proper hierarchy and filtering
  const buildParentOptions = useCallback(() => {
    if (!projects) return []

    type ParentOption = {
      id?: string
      name: string
      color?: string
      level: number
      isNoParent?: boolean
    }

    const options: ParentOption[] = []

    // Add "No parent" option
    options.push({ name: 'No parent (top-level project)', level: 0, isNoParent: true })

    // Add all projects with proper hierarchy, filtering out those at max depth
    const addProjectAndChildren = (project: TodoistProject, level: number) => {
      const projectDepth = getProjectDepth(project.todoist_id)
      // Todoist allows max 4 levels (0, 1, 2, 3), so projects at depth 3 can't be parents
      if (projectDepth < 3) {
        options.push({
          id: project.todoist_id,
          name: project.name,
          color: project.color,
          level
        })
      }

      // Find and add children
      const children = projects.filter((p: TodoistProject) => p.parent_id === project.todoist_id)
      children.forEach((child: TodoistProject) => addProjectAndChildren(child, level + 1))
    }

    // Start with root projects
    const rootProjects = projects.filter((p: TodoistProject) => !p.parent_id)
    rootProjects.forEach((project: TodoistProject) => addProjectAndChildren(project, 0))

    return options
  }, [projects, getProjectDepth])

  const buildProjectHierarchy = () => {
    if (!projects) return []

    const rootProjects = projects.filter((p: TodoistProject) => !p.parent_id)

    type ProjectWithLevel = TodoistProject & { level: number }
    type CreateNewOption = { createNew: true }
    type DividerOption = { divider: true }
    const result: (ProjectWithLevel | CreateNewOption | DividerOption)[] = []

    const addProjectWithChildren = (project: TodoistProject, level: number) => {
      const matchesSearch = !searchTerm || project.name.toLowerCase().includes(searchTerm.toLowerCase())

      if (matchesSearch || !searchTerm) {
        result.push({ ...project, level })
      }

      const children = projects.filter((p: TodoistProject) => p.parent_id === project.todoist_id)
      children.forEach((child: TodoistProject) => addProjectWithChildren(child, level + 1))
    }

    rootProjects.forEach((project: TodoistProject) => addProjectWithChildren(project, 0))

    // Add "Create new project" option if search term exists and doesn't match any project exactly
    if (searchTerm && !projects.some((p: TodoistProject) =>
      p.name.toLowerCase() === searchTerm.toLowerCase()
    )) {
      // Add divider if there are existing results
      if (result.length > 0) {
        result.push({ divider: true })
      }
      result.push({ createNew: true })
    }

    return result
  }

  const filteredProjects = buildProjectHierarchy()

  // Handler for creating a new project
  const handleCreateProject = useCallback(async () => {
    if (!searchTerm.trim()) return

    try {
      setIsCreatingProject(true)

      const newProject = await createProject({
        name: searchTerm.trim(),
        parentId: selectedParentId,
        color: selectedColor,
      })

      if (newProject) {
        // Select the newly created project
        onSelect(newProject.id)
      }
    } catch (error) {
      console.error('Error creating project:', error)
    } finally {
      setIsCreatingProject(false)
    }
  }, [searchTerm, selectedParentId, selectedColor, createProject, onSelect])

  useEffect(() => {
    if (task) {
      setSearchTerm('')
      setSelectedIndex(0)
      setIsSelectingParent(false)
      setIsSelectingColor(false)
      setSelectedParentId(undefined)
      setSelectedColor('charcoal')
      setIsCreatingProject(false)
      setParentSelectorIndex(0)
      setColorSelectorIndex(17) // charcoal

      setTimeout(() => searchInputRef.current?.focus(), 100)
    }
  }, [task])

  useEffect(() => {
    if (selectedIndex >= filteredProjects.length) {
      setSelectedIndex(Math.max(0, filteredProjects.length - 1))
    }
  }, [filteredProjects.length, selectedIndex])

  useEffect(() => {
    selectedProjectRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [selectedIndex])

  // Auto-scroll effects
  useEffect(() => {
    if (isSelectingParent && parentProjectRef.current) {
      parentProjectRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [parentSelectorIndex, isSelectingParent])

  useEffect(() => {
    if (isSelectingColor && colorButtonRef.current) {
      colorButtonRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [colorSelectorIndex, isSelectingColor])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Handle parent selector navigation
    if (isSelectingParent) {
      const parentOptions = buildParentOptions()

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setParentSelectorIndex(prev => Math.min(prev + 1, parentOptions.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setParentSelectorIndex(prev => Math.max(prev - 1, 0))
          break
        case 'Enter': {
          e.preventDefault()
          const selectedOption = parentOptions[parentSelectorIndex]
          if (selectedOption.isNoParent) {
            setSelectedParentId(undefined)
            setSelectedColor('charcoal')
          } else {
            setSelectedParentId(selectedOption.id)
            setSelectedColor(selectedOption.color || 'charcoal')
          }
          setIsSelectingParent(false)
          setIsSelectingColor(true)
          // Find the index of the current color in colorOptions
          const colorIndex = TODOIST_COLOR_OPTIONS.findIndex(c => c.name === (selectedOption.color || 'charcoal'))
          setColorSelectorIndex(colorIndex >= 0 ? colorIndex : 17)
          break
        }
        case 'Escape':
          e.preventDefault()
          setIsSelectingParent(false)
          setParentSelectorIndex(0)
          break
      }
      return
    }

    // Handle color selector navigation
    if (isSelectingColor) {
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault()
          setColorSelectorIndex(prev => (prev + 1) % TODOIST_COLOR_OPTIONS.length)
          break
        case 'ArrowLeft':
          e.preventDefault()
          setColorSelectorIndex(prev => (prev - 1 + TODOIST_COLOR_OPTIONS.length) % TODOIST_COLOR_OPTIONS.length)
          break
        case 'ArrowDown':
          e.preventDefault()
          // 5 columns per row
          setColorSelectorIndex(prev => Math.min(prev + 5, TODOIST_COLOR_OPTIONS.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          // 5 columns per row
          setColorSelectorIndex(prev => Math.max(prev - 5, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (TODOIST_COLOR_OPTIONS[colorSelectorIndex]) {
            setSelectedColor(TODOIST_COLOR_OPTIONS[colorSelectorIndex].name)
            setIsSelectingColor(false)
            handleCreateProject()
          }
          break
        case 'Escape':
          e.preventDefault()
          setIsSelectingColor(false)
          setIsSelectingParent(true)
          break
      }
      return
    }

    // Handle regular project list navigation
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(prev => {
          let next = Math.min(prev + 1, filteredProjects.length - 1)
          // Skip dividers
          while (next < filteredProjects.length && 'divider' in filteredProjects[next]) {
            next++
          }
          return Math.min(next, filteredProjects.length - 1)
        })
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev => {
          let next = Math.max(prev - 1, 0)
          // Skip dividers
          while (next >= 0 && 'divider' in filteredProjects[next]) {
            next--
          }
          return Math.max(next, 0)
        })
        break
      case 'Enter': {
        e.preventDefault()
        const selected = filteredProjects[selectedIndex]
        if (selected && !('divider' in selected)) {
          if ('createNew' in selected) {
            // Start project creation flow
            if (!isSelectingParent && !isSelectingColor) {
              setIsSelectingParent(true)
              setParentSelectorIndex(0)
            }
          } else {
            onSelect(selected.todoist_id)
          }
        }
        break
      }
    }
  }

  if (!task) return null

  return (
    <Dialog open={!!task} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-lg max-h-[80vh] flex flex-col p-0"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader className="p-6 pb-4 space-y-3">
          <DialogTitle className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">#</span>
            </div>
            Select Project
          </DialogTitle>
          <DialogDescription className="text-sm font-medium text-blue-900 leading-tight">
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
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-4 border-b border-gray-200">
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
            {filteredProjects.map((item, index) => {
              // Handle divider
              if ('divider' in item) {
                return (
                  <div key={`divider-${index}`} className="my-2 border-t border-gray-200" />
                )
              }

              // Handle create new project option
              if ('createNew' in item) {
                const isSelected = index === selectedIndex

                // Show parent selector
                if (isSelectingParent) {
                  const parentOptions = buildParentOptions()

                  return (
                    <div key="parent-selector" className="p-4 space-y-4">
                      <div className="text-sm font-medium text-gray-700">
                        Select parent project for &quot;{searchTerm}&quot;
                      </div>
                      <div className="space-y-1 max-h-96 overflow-y-auto">
                        {parentOptions.map((option, idx) => {
                          const isOptionSelected = idx === parentSelectorIndex
                          const isCurrentlySelected = option.isNoParent ? !selectedParentId : option.id === selectedParentId

                          return (
                            <button
                              key={option.id || 'no-parent'}
                              ref={isOptionSelected ? parentProjectRef : null}
                              onClick={() => {
                                if (option.isNoParent) {
                                  setSelectedParentId(undefined)
                                  setSelectedColor('charcoal')
                                } else {
                                  setSelectedParentId(option.id)
                                  setSelectedColor(option.color || 'charcoal')
                                }
                                setIsSelectingParent(false)
                                setIsSelectingColor(true)
                              }}
                              className={cn(
                                'w-full text-left p-2.5 rounded-md transition-all duration-150 flex items-center gap-2 border',
                                isOptionSelected
                                  ? 'bg-blue-50 border-blue-300'
                                  : isCurrentlySelected
                                  ? 'bg-green-50 border-green-200'
                                  : 'hover:bg-gray-50 border-transparent'
                              )}
                              style={{ paddingLeft: `${0.75 + option.level * 1.5}rem` }}
                            >
                              {option.level > 0 && (
                                <ChevronRight className="h-3 w-3 text-gray-400" />
                              )}
                              {!option.isNoParent && (
                                <div
                                  className="w-3 h-3 rounded-full flex-shrink-0"
                                  style={{ backgroundColor: getProjectColor(option.color || 'charcoal') }}
                                />
                              )}
                              <span className={option.isNoParent ? 'text-gray-500' : 'text-gray-900'}>
                                {option.name}
                              </span>
                              {isCurrentlySelected && (
                                <span className="ml-auto text-xs text-green-600">✓ Selected</span>
                              )}
                              {isOptionSelected && (
                                <span className="ml-auto text-xs text-blue-500 font-bold">↵</span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                      <div className="text-xs text-gray-500 pt-2 border-t">
                        ↑↓ to navigate • Enter to select • ESC to go back
                      </div>
                    </div>
                  )
                }

                // Show color selector
                if (isSelectingColor) {
                  const selectedParentProject = projects?.find((p: TodoistProject) => p.todoist_id === selectedParentId)

                  return (
                    <div key="color-selector" className="p-4 space-y-4">
                      <div className="text-sm font-medium text-gray-700">
                        Select color for &quot;{searchTerm}&quot;
                        {selectedParentProject && (
                          <span className="text-gray-500 text-xs block mt-1">
                            Parent: {selectedParentProject.name}
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-5 gap-3">
                        {TODOIST_COLOR_OPTIONS.map((color, idx) => {
                          const isColorSelected = idx === colorSelectorIndex
                          const isCurrentColor = color.name === selectedColor

                          return (
                            <button
                              key={color.name}
                              ref={isColorSelected ? colorButtonRef : null}
                              onClick={() => {
                                setSelectedColor(color.name)
                                setColorSelectorIndex(idx)
                              }}
                              onMouseEnter={() => setColorSelectorIndex(idx)}
                              className={cn(
                                'relative w-full aspect-square rounded-full transition-all',
                                isColorSelected
                                  ? 'ring-2 ring-blue-500 ring-offset-2 scale-110'
                                  : isCurrentColor
                                  ? 'ring-2 ring-green-500 ring-offset-2'
                                  : 'hover:scale-110 hover:ring-2 hover:ring-gray-300 hover:ring-offset-1'
                              )}
                              style={{ backgroundColor: color.hex }}
                              title={color.displayName}
                            >
                              {(isCurrentColor || isColorSelected) && (
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <span className="text-white text-sm font-bold drop-shadow">
                                    {isCurrentColor ? '✓' : ''}
                                  </span>
                                </div>
                              )}
                            </button>
                          )
                        })}
                      </div>
                      <div className="pt-2 border-t space-y-2">
                        <div className="text-xs text-gray-500 text-center">
                          ←→↑↓ to navigate • Enter to create • ESC to go back
                        </div>
                        <div className="flex items-center justify-between">
                          <button
                            onClick={() => {
                              setIsSelectingColor(false)
                              setIsSelectingParent(true)
                              setParentSelectorIndex(0)
                            }}
                            className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
                          >
                            <span className="text-lg">←</span> Back to parent
                          </button>
                          <button
                            onClick={() => handleCreateProject()}
                            className="px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded-md hover:bg-blue-600 transition-colors disabled:opacity-50"
                            disabled={isCreatingProject}
                          >
                            {isCreatingProject ? 'Creating...' : 'Create Project'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                }

                // Show "Create new project" button
                return (
                  <button
                    key="create-new"
                    ref={isSelected ? selectedProjectRef : null}
                    onClick={() => {
                      if (!isSelectingParent && !isSelectingColor) {
                        setIsSelectingParent(true)
                      }
                    }}
                    className={cn(
                      'w-full text-left p-2.5 rounded-md transition-all duration-150 flex items-center space-x-2 border',
                      isSelected
                        ? 'bg-blue-50 border-blue-300'
                        : 'hover:bg-gray-50 border-transparent',
                      isCreatingProject && 'opacity-50'
                    )}
                    disabled={isCreatingProject}
                  >
                    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-gradient-to-br from-green-500 to-green-600 flex-shrink-0">
                      <Plus className="w-3 h-3 text-white" />
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-sm text-gray-900">
                        Create &quot;{searchTerm}&quot; as new project
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        Press Enter to select parent and color
                      </div>
                    </div>
                    {isSelected && (
                      <div className="text-xs font-bold text-blue-500">
                        ↵
                      </div>
                    )}
                  </button>
                )
              }

              // Handle regular project item
              const project = item
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
      </DialogContent>
    </Dialog>
  )
}
