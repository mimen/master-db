import { useQuery } from 'convex/react'
import { Folder, Plus } from 'lucide-react'
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
  const [parentSearchTerm, setParentSearchTerm] = useState('')
  const parentSearchInputRef = useRef<HTMLInputElement>(null)
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
  const buildParentOptions = useCallback((searchFilter: string = '') => {
    if (!projects) return []

    type ParentOption = {
      id?: string
      name: string
      color?: string
      level: number
      isNoParent?: boolean
    }

    const options: ParentOption[] = []

    // Add "No parent" option if it matches search or no search
    if (!searchFilter || 'no parent'.includes(searchFilter.toLowerCase()) || 'top level'.includes(searchFilter.toLowerCase())) {
      options.push({ name: 'No parent (top-level project)', level: 0, isNoParent: true })
    }

    // Add all projects with proper hierarchy, filtering out those at max depth
    const addProjectAndChildren = (project: TodoistProject, level: number) => {
      const projectDepth = getProjectDepth(project.todoist_id)
      const matchesSearch = !searchFilter || project.name.toLowerCase().includes(searchFilter.toLowerCase())

      // Todoist allows max 4 levels (0, 1, 2, 3), so projects at depth 3 can't be parents
      if (projectDepth < 3 && matchesSearch) {
        options.push({
          id: project.todoist_id,
          name: project.name,
          color: project.color,
          level
        })
      }

      // Find and add children (sorted by child_order)
      const children = projects
        .filter((p: TodoistProject) => p.parent_id === project.todoist_id)
        .sort((a, b) => a.child_order - b.child_order)
      children.forEach((child: TodoistProject) => addProjectAndChildren(child, level + 1))
    }

    // Start with root projects (sorted by child_order)
    const rootProjects = projects
      .filter((p: TodoistProject) => !p.parent_id)
      .sort((a, b) => a.child_order - b.child_order)
    rootProjects.forEach((project: TodoistProject) => addProjectAndChildren(project, 0))

    return options
  }, [projects, getProjectDepth])

  const buildProjectHierarchy = () => {
    if (!projects) return []

    const rootProjects = projects
      .filter((p: TodoistProject) => !p.parent_id)
      .sort((a, b) => a.child_order - b.child_order)

    type ProjectWithLevel = TodoistProject & { level: number }
    type CreateNewOption = { createNew: true }
    type DividerOption = { divider: true }
    const result: (ProjectWithLevel | CreateNewOption | DividerOption)[] = []

    const addProjectWithChildren = (project: TodoistProject, level: number) => {
      const matchesSearch = !searchTerm || project.name.toLowerCase().includes(searchTerm.toLowerCase())

      if (matchesSearch || !searchTerm) {
        result.push({ ...project, level })
      }

      const children = projects
        .filter((p: TodoistProject) => p.parent_id === project.todoist_id)
        .sort((a, b) => a.child_order - b.child_order)
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
  const handleCreateProject = useCallback(async (colorOverride?: string) => {
    if (!searchTerm.trim()) return

    try {
      setIsCreatingProject(true)

      const newProject = await createProject({
        name: searchTerm.trim(),
        parentId: selectedParentId,
        color: colorOverride ?? selectedColor,
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
      setParentSearchTerm('')

      setTimeout(() => searchInputRef.current?.focus(), 100)
    }
  }, [task])

  // Focus parent search input when entering parent selection
  useEffect(() => {
    if (isSelectingParent) {
      setParentSearchTerm('')
      setTimeout(() => parentSearchInputRef.current?.focus(), 100)
    }
  }, [isSelectingParent])

  useEffect(() => {
    if (selectedIndex >= filteredProjects.length) {
      setSelectedIndex(Math.max(0, filteredProjects.length - 1))
    }
  }, [filteredProjects.length, selectedIndex])

  // Reset parent selector index when search changes
  useEffect(() => {
    setParentSelectorIndex(0)
  }, [parentSearchTerm])

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
      const parentOptions = buildParentOptions(parentSearchTerm)

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
          // 9 columns per row
          setColorSelectorIndex(prev => Math.min(prev + 9, TODOIST_COLOR_OPTIONS.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          // 9 columns per row
          setColorSelectorIndex(prev => Math.max(prev - 9, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (TODOIST_COLOR_OPTIONS[colorSelectorIndex]) {
            const newColor = TODOIST_COLOR_OPTIONS[colorSelectorIndex].name
            setSelectedColor(newColor)
            setIsSelectingColor(false)
            handleCreateProject(newColor)
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
        className="max-w-sm max-h-[80vh] flex flex-col p-0"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle className="flex items-center gap-2.5 text-base">
            <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
            Select Project
          </DialogTitle>
          <DialogDescription className="text-sm font-medium leading-snug pt-1">
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
                    className="text-primary hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {segment.content}
                  </a>
                )
              }
            })}
          </DialogDescription>
        </DialogHeader>

        {!isSelectingParent && !isSelectingColor && (
          <div className="px-6 pb-3 border-b">
            <input
              ref={searchInputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-8 px-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Search projects..."
            />
            <div className="mt-2 text-xs text-muted-foreground">
              ↑↓ navigate • Enter select • ESC cancel
            </div>
          </div>
        )}

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {filteredProjects.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            {searchTerm ? `No projects found for "${searchTerm}"` : 'No projects available'}
          </div>
        ) : (
          <div className="space-y-0.5">
            {filteredProjects.map((item, index) => {
              // Handle divider
              if ('divider' in item) {
                return (
                  <div key={`divider-${index}`} className="my-2 border-t" />
                )
              }

              // Handle create new project option
              if ('createNew' in item) {
                const isSelected = index === selectedIndex

                // Show parent selector
                if (isSelectingParent) {
                  const parentOptions = buildParentOptions(parentSearchTerm)

                  return (
                    <div key="parent-selector" className="space-y-3">
                      <div className="px-2 text-sm font-medium">
                        Select parent for &quot;{searchTerm}&quot;
                      </div>
                      <div className="px-2">
                        <input
                          ref={parentSearchInputRef}
                          type="text"
                          value={parentSearchTerm}
                          onChange={(e) => {
                            setParentSearchTerm(e.target.value)
                            setParentSelectorIndex(0)
                          }}
                          className="w-full h-8 px-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                          placeholder="Search parent projects..."
                        />
                      </div>
                      <div className="space-y-0.5 max-h-96 overflow-y-auto">
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
                                'flex w-full items-center gap-2 rounded-md p-2 text-left text-sm transition-colors h-8',
                                'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                                isOptionSelected && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
                                isCurrentlySelected && !isOptionSelected && 'font-medium'
                              )}
                              style={{ paddingLeft: `${8 + option.level * 16}px` }}
                            >
                              {!option.isNoParent && (
                                <div
                                  className="w-3 h-3 rounded-full shrink-0"
                                  style={{ backgroundColor: getProjectColor(option.color || 'charcoal') }}
                                />
                              )}
                              <span className={cn('flex-1 truncate min-w-0', option.isNoParent && 'text-muted-foreground')}>
                                {option.name}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                      <div className="px-2 text-xs text-muted-foreground pt-2 border-t">
                        ↑↓ navigate • Enter select • ESC back
                      </div>
                    </div>
                  )
                }

                // Show color selector
                if (isSelectingColor) {
                  const selectedParentProject = projects?.find((p: TodoistProject) => p.todoist_id === selectedParentId)

                  return (
                    <div key="color-selector" className="space-y-4">
                      <div className="px-2 space-y-2">
                        <div className="text-sm font-medium">Choose color</div>
                        {selectedParentProject && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <div
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: getProjectColor(selectedParentProject.color) }}
                            />
                            <span className="truncate">{selectedParentProject.name}</span>
                          </div>
                        )}
                      </div>
                      <div className="px-2">
                        <div className="grid grid-cols-9 gap-2">
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
                                  'relative w-7 h-7 rounded-full transition-all',
                                  isColorSelected
                                    ? 'ring-2 ring-foreground ring-offset-2 scale-125'
                                    : 'hover:scale-110'
                                )}
                                style={{ backgroundColor: color.hex }}
                                title={color.displayName}
                              >
                                {isCurrentColor && (
                                  <div className="absolute inset-0 flex items-center justify-center">
                                    <span className="text-white text-[10px] font-bold drop-shadow-md">✓</span>
                                  </div>
                                )}
                              </button>
                            )
                          })}
                        </div>
                        {TODOIST_COLOR_OPTIONS[colorSelectorIndex] && (
                          <div className="mt-2 text-xs text-center text-muted-foreground">
                            {TODOIST_COLOR_OPTIONS[colorSelectorIndex].displayName}
                          </div>
                        )}
                      </div>
                      <div className="pt-2 border-t space-y-2">
                        <div className="px-2 text-xs text-muted-foreground text-center">
                          ←→↑↓ navigate • Enter create • ESC back
                        </div>
                        <div className="px-2 flex items-center justify-between">
                          <button
                            onClick={() => {
                              setIsSelectingColor(false)
                              setIsSelectingParent(true)
                              setParentSelectorIndex(0)
                            }}
                            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
                          >
                            <span className="text-lg">←</span> Back
                          </button>
                          <button
                            onClick={() => handleCreateProject()}
                            className="px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
                            disabled={isCreatingProject}
                          >
                            {isCreatingProject ? 'Creating...' : 'Create'}
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
                      'flex w-full items-center gap-2 rounded-md p-2 text-left text-sm transition-colors',
                      'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                      isSelected && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
                      isCreatingProject && 'opacity-50'
                    )}
                    disabled={isCreatingProject}
                  >
                    <div className="flex items-center justify-center w-4 h-4 rounded-full bg-green-600 shrink-0">
                      <Plus className="w-3 h-3 text-white" />
                    </div>
                    <span className="flex-1 truncate min-w-0">
                      Create &quot;{searchTerm}&quot;
                    </span>
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
                    'flex w-full items-center gap-2 rounded-md p-2 text-left text-sm transition-colors h-8',
                    'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                    isSelected && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
                    isCurrent && !isSelected && 'font-medium'
                  )}
                  style={{ paddingLeft: `${8 + project.level * 16}px` }}
                >
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: getProjectColor(project.color) }}
                  />
                  <span className="flex-1 truncate min-w-0">{project.name}</span>
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
