import { Repeat, Search, Tag } from "lucide-react"
import type { ReactNode } from "react"
import { useCallback, useEffect, useState } from "react"

import type { ProjectTreeNode, ViewNavItem } from "../types"
import { PRIORITY_FILTER_ITEMS, PRIORITY_PROJECTS_ITEMS, TIME_FILTER_ITEMS } from "../utils/filterItems"

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { useCountRegistry } from "@/contexts/CountContext"
import { useDialogContext } from "@/contexts/DialogContext"
import { getProjectColor } from "@/lib/colors"
import { getViewIcon } from "@/lib/icons/viewIcons"
import { getPriorityColorClass } from "@/lib/priorities"
import { cn } from "@/lib/utils"
import type { ViewKey, ViewSelection, ViewBuildContext } from "@/lib/views/types"
import { resolveView } from "@/lib/views/viewDefinitions"
import type { TodoistLabelDoc } from "@/types/convex/todoist"

interface NavHeaderProps {
  onViewChange: (view: ViewSelection) => void
  projects: ProjectTreeNode[]
  labels: TodoistLabelDoc[] | undefined
  viewContext: ViewBuildContext
  viewItems: ViewNavItem[]
}

interface SearchableItem {
  id: string
  label: string
  category: "view" | "project" | "time" | "priority" | "priority-projects" | "label" | "routine"
  viewKey: ViewKey
  icon?: ReactNode
}

export function NavHeader({ onViewChange, projects, labels, viewContext, viewItems }: NavHeaderProps) {
  const { openSettings } = useDialogContext()
  const { registry } = useCountRegistry()
  const [open, setOpen] = useState(false)
  const [searchItems, setSearchItems] = useState<SearchableItem[]>([])

  // Build searchable items from all sections
  useEffect(() => {
    const items: SearchableItem[] = []

    // Views - use the actual viewItems passed in
    viewItems.forEach((view) => {
      const ViewIcon = view.icon
      items.push({
        id: view.key,
        label: view.label,
        category: "view",
        viewKey: view.key,
        icon: <ViewIcon className="h-4 w-4" />,
      })
    })

    // Time filters - from centralized definitions
    TIME_FILTER_ITEMS.forEach((timeFilter) => {
      items.push({
        id: timeFilter.id,
        label: timeFilter.label,
        category: "time",
        viewKey: timeFilter.viewKey,
        icon: getViewIcon(timeFilter.viewKey, { size: "sm" }),
      })
    })

    // Priorities - from centralized definitions
    PRIORITY_FILTER_ITEMS.forEach((priority) => {
      const PriorityIcon = priority.icon
      const colorClass = getPriorityColorClass(priority.priorityLevel)
      items.push({
        id: priority.id,
        label: priority.label,
        category: "priority",
        viewKey: priority.viewKey,
        icon: <PriorityIcon className={cn("h-4 w-4", colorClass)} fill="currentColor" />,
      })
    })

    // Priority Projects - from centralized definitions
    PRIORITY_PROJECTS_ITEMS.forEach((priority) => {
      const PriorityIcon = priority.icon
      const colorClass = getPriorityColorClass(priority.priorityLevel)
      items.push({
        id: priority.id,
        label: priority.label,
        category: "priority-projects",
        viewKey: priority.viewKey,
        icon: <PriorityIcon className={cn("h-4 w-4", colorClass)} fill="currentColor" />,
      })
    })

    // Projects (flatten tree)
    const flattenProjects = (projectList: ProjectTreeNode[], parentPath = ""): void => {
      projectList.forEach((project) => {
        const path = parentPath ? `${parentPath} > ${project.name}` : project.name
        items.push({
          id: `project-${project.todoist_id}`,
          label: path,
          category: "project",
          viewKey: `view:project:${project.todoist_id}` as ViewKey,
          icon: (
            <div
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: getProjectColor(project.color) }}
            />
          ),
        })
        if (project.children.length > 0) {
          flattenProjects(project.children, path)
        }
      })
    }
    flattenProjects(projects)

    // Routine Projects - projects that have routines
    if (viewContext.projectsWithMetadata) {
      const allCounts = registry.getAllCounts()
      const projectsWithRoutines = viewContext.projectsWithMetadata.filter((project) => {
        const countKey = `list:routines:${project.todoist_id}`
        const count = allCounts[countKey] ?? 0
        return count > 0
      })

      projectsWithRoutines.forEach((project) => {
        items.push({
          id: `routine-${project.todoist_id}`,
          label: `Routines > ${project.name}`,
          category: "routine",
          viewKey: `view:routines:project:${project.todoist_id}` as ViewKey,
          icon: <Repeat className="h-4 w-4" style={{ color: getProjectColor(project.color) }} />,
        })
      })
    }

    // Labels
    if (labels) {
      labels.forEach((label) => {
        items.push({
          id: `label-${label.todoist_id}`,
          label: `@${label.name}`,
          category: "label",
          viewKey: `view:label:${label.name}` as ViewKey,
          icon: <Tag className="h-4 w-4" style={{ color: getProjectColor(label.color) }} />,
        })
      })
    }

    setSearchItems(items)
  }, [projects, labels, viewItems, viewContext, registry])

  // Register ⌘K shortcut
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }
    }

    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [])

  const handleSelect = useCallback(
    (viewKey: ViewKey) => {
      setOpen(false)
      // Settings is a special case - open dialog instead of changing view
      if (viewKey === "view:settings") {
        openSettings()
      } else {
        onViewChange(resolveView(viewKey, viewContext))
      }
    },
    [onViewChange, viewContext, openSettings]
  )

  return (
    <>
      <div className="px-2 py-2">
        <button
          onClick={() => setOpen(true)}
          className="flex h-8 w-full items-center gap-2 rounded-md border border-sidebar-border bg-sidebar px-2 text-sm text-sidebar-foreground/50 shadow-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <Search className="h-4 w-4" />
          <span className="flex-1 text-left">Search...</span>
          <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border border-sidebar-border bg-sidebar-accent px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
            <span className="text-xs">⌘</span>K
          </kbd>
        </button>
      </div>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search views, projects, labels..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          <CommandGroup heading="Views">
            {searchItems
              .filter((item) => item.category === "view")
              .map((item) => (
                <CommandItem key={item.id} onSelect={() => handleSelect(item.viewKey)}>
                  {item.icon && <span className="mr-2 flex items-center justify-center">{item.icon}</span>}
                  {item.label}
                </CommandItem>
              ))}
          </CommandGroup>

          <CommandGroup heading="Time Filters">
            {searchItems
              .filter((item) => item.category === "time")
              .map((item) => (
                <CommandItem key={item.id} onSelect={() => handleSelect(item.viewKey)}>
                  {item.icon && <span className="mr-2 flex items-center justify-center">{item.icon}</span>}
                  {item.label}
                </CommandItem>
              ))}
          </CommandGroup>

          <CommandGroup heading="Projects">
            {searchItems
              .filter((item) => item.category === "project")
              .map((item) => {
                const hasParent = item.label.includes(" > ")
                const lastSeparatorIndex = item.label.lastIndexOf(" > ")
                const parentPath = hasParent ? item.label.substring(0, lastSeparatorIndex + 3) : ""
                const projectName = hasParent ? item.label.substring(lastSeparatorIndex + 3) : item.label

                return (
                  <CommandItem key={item.id} onSelect={() => handleSelect(item.viewKey)}>
                    {item.icon && <span className="mr-2 flex items-center justify-center">{item.icon}</span>}
                    <span>
                      {hasParent && <span className="text-xs text-muted-foreground">{parentPath}</span>}
                      <span>{projectName}</span>
                    </span>
                  </CommandItem>
                )
              })}
          </CommandGroup>

          <CommandGroup heading="Priorities">
            {searchItems
              .filter((item) => item.category === "priority")
              .map((item) => (
                <CommandItem key={item.id} onSelect={() => handleSelect(item.viewKey)}>
                  {item.icon && <span className="mr-2 flex items-center justify-center">{item.icon}</span>}
                  {item.label}
                </CommandItem>
              ))}
          </CommandGroup>

          <CommandGroup heading="Projects by Priority">
            {searchItems
              .filter((item) => item.category === "priority-projects")
              .map((item) => (
                <CommandItem key={item.id} onSelect={() => handleSelect(item.viewKey)}>
                  {item.icon && <span className="mr-2 flex items-center justify-center">{item.icon}</span>}
                  {item.label}
                </CommandItem>
              ))}
          </CommandGroup>

          <CommandGroup heading="Routines">
            {searchItems
              .filter((item) => item.category === "routine")
              .map((item) => {
                const separatorIndex = item.label.indexOf(" > ")
                const prefix = separatorIndex >= 0 ? item.label.substring(0, separatorIndex + 3) : ""
                const projectName = separatorIndex >= 0 ? item.label.substring(separatorIndex + 3) : item.label

                return (
                  <CommandItem key={item.id} onSelect={() => handleSelect(item.viewKey)}>
                    {item.icon && <span className="mr-2 flex items-center justify-center">{item.icon}</span>}
                    <span>
                      {prefix && <span className="text-xs text-muted-foreground">{prefix}</span>}
                      <span>{projectName}</span>
                    </span>
                  </CommandItem>
                )
              })}
          </CommandGroup>

          <CommandGroup heading="Labels">
            {searchItems
              .filter((item) => item.category === "label")
              .map((item) => (
                <CommandItem key={item.id} onSelect={() => handleSelect(item.viewKey)}>
                  {item.icon && <span className="mr-2 flex items-center justify-center">{item.icon}</span>}
                  {item.label}
                </CommandItem>
              ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  )
}
