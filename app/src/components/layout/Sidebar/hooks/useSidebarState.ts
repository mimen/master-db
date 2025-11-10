import { useCallback, useEffect, useState } from "react"

import type { ProjectSort, LabelSort } from "../types"

interface CollapsedSections {
  projects: boolean
  time: boolean
  priorities: boolean
  labels: boolean
}

const STORAGE_KEYS = {
  COLLAPSED_SECTIONS: "sidebar:collapsedSections",
  COLLAPSED_PROJECTS: "sidebar:collapsedProjects",
  COLLAPSED_PRIORITY_GROUPS: "sidebar:collapsedPriorityGroups",
  EXPAND_NESTED: "sidebar:expandNested",
  PRIORITY_MODE: "sidebar:priorityMode",
  PROJECT_SORT: "sidebar:projectSort",
  LABEL_SORT: "sidebar:labelSort",
} as const

// Helper to safely read from localStorage
function getStoredValue<T>(key: string, defaultValue: T): T {
  try {
    const item = window.localStorage.getItem(key)
    return item ? JSON.parse(item) : defaultValue
  } catch (error) {
    console.warn(`Error reading localStorage key "${key}":`, error)
    return defaultValue
  }
}

// Helper to safely write to localStorage
function setStoredValue<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    console.warn(`Error writing localStorage key "${key}":`, error)
  }
}

export function useSidebarState() {
  // Initialize state from localStorage
  const [expandNested, setExpandNestedState] = useState<boolean>(() =>
    getStoredValue(STORAGE_KEYS.EXPAND_NESTED, false)
  )
  const [priorityMode, setPriorityModeState] = useState<"tasks" | "projects">(() =>
    getStoredValue(STORAGE_KEYS.PRIORITY_MODE, "tasks")
  )
  const [projectSort, setProjectSortState] = useState<ProjectSort>(() =>
    getStoredValue(STORAGE_KEYS.PROJECT_SORT, "hierarchy")
  )
  const [labelSort, setLabelSortState] = useState<LabelSort>(() =>
    getStoredValue(STORAGE_KEYS.LABEL_SORT, "taskCount")
  )

  // Collapsible sections state - all open by default, persist in localStorage
  const [collapsed, setCollapsed] = useState<CollapsedSections>(() =>
    getStoredValue(STORAGE_KEYS.COLLAPSED_SECTIONS, {
      projects: false,
      time: false,
      priorities: false,
      labels: false,
    })
  )

  // Collapsed projects state - store project IDs that are collapsed
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => {
    const stored = getStoredValue<string[]>(STORAGE_KEYS.COLLAPSED_PROJECTS, [])
    return new Set(stored)
  })

  // Collapsed priority groups state - store priority levels that are collapsed
  const [collapsedPriorityGroups, setCollapsedPriorityGroups] = useState<Set<number>>(() => {
    const stored = getStoredValue<number[]>(STORAGE_KEYS.COLLAPSED_PRIORITY_GROUPS, [])
    return new Set(stored)
  })

  // Persist collapsed sections to localStorage
  useEffect(() => {
    setStoredValue(STORAGE_KEYS.COLLAPSED_SECTIONS, collapsed)
  }, [collapsed])

  // Persist collapsed projects to localStorage
  useEffect(() => {
    setStoredValue(STORAGE_KEYS.COLLAPSED_PROJECTS, Array.from(collapsedProjects))
  }, [collapsedProjects])

  // Persist collapsed priority groups to localStorage
  useEffect(() => {
    setStoredValue(STORAGE_KEYS.COLLAPSED_PRIORITY_GROUPS, Array.from(collapsedPriorityGroups))
  }, [collapsedPriorityGroups])

  const toggleSection = useCallback((section: keyof CollapsedSections) => {
    setCollapsed((prev) => ({
      ...prev,
      [section]: !prev[section],
    }))
  }, [])

  // Wrapped setters that persist to localStorage
  const setExpandNested = useCallback((value: boolean) => {
    setExpandNestedState(value)
    setStoredValue(STORAGE_KEYS.EXPAND_NESTED, value)
  }, [])

  const setPriorityMode = useCallback((value: "tasks" | "projects") => {
    setPriorityModeState(value)
    setStoredValue(STORAGE_KEYS.PRIORITY_MODE, value)
  }, [])

  const setProjectSort = useCallback((value: ProjectSort) => {
    setProjectSortState(value)
    setStoredValue(STORAGE_KEYS.PROJECT_SORT, value)
  }, [])

  const setLabelSort = useCallback((value: LabelSort) => {
    setLabelSortState(value)
    setStoredValue(STORAGE_KEYS.LABEL_SORT, value)
  }, [])

  const cycleProjectSort = useCallback(() => {
    const sorts: ProjectSort[] = ["hierarchy", "priority", "taskCount", "alphabetical"]
    const currentIndex = sorts.indexOf(projectSort)
    const nextIndex = (currentIndex + 1) % sorts.length
    const nextSort = sorts[nextIndex]
    setProjectSortState(nextSort)
    setStoredValue(STORAGE_KEYS.PROJECT_SORT, nextSort)
  }, [projectSort])

  const cycleLabelSort = useCallback(() => {
    const sorts: LabelSort[] = ["taskCount", "alphabetical"]
    const currentIndex = sorts.indexOf(labelSort)
    const nextIndex = (currentIndex + 1) % sorts.length
    const nextSort = sorts[nextIndex]
    setLabelSortState(nextSort)
    setStoredValue(STORAGE_KEYS.LABEL_SORT, nextSort)
  }, [labelSort])

  const togglePriorityMode = useCallback(() => {
    setPriorityMode((prev) => (prev === "tasks" ? "projects" : "tasks"))
  }, [])

  const toggleProjectCollapse = useCallback((projectId: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) {
        next.delete(projectId)
      } else {
        next.add(projectId)
      }
      return next
    })
  }, [])

  const isProjectCollapsed = useCallback(
    (projectId: string) => collapsedProjects.has(projectId),
    [collapsedProjects]
  )

  const togglePriorityGroupCollapse = useCallback((priority: number) => {
    setCollapsedPriorityGroups((prev) => {
      const next = new Set(prev)
      if (next.has(priority)) {
        next.delete(priority)
      } else {
        next.add(priority)
      }
      return next
    })
  }, [])

  const isPriorityGroupCollapsed = useCallback(
    (priority: number) => collapsedPriorityGroups.has(priority),
    [collapsedPriorityGroups]
  )

  return {
    expandNested,
    setExpandNested,
    priorityMode,
    setPriorityMode,
    togglePriorityMode,
    projectSort,
    setProjectSort,
    cycleProjectSort,
    labelSort,
    setLabelSort,
    cycleLabelSort,
    collapsed,
    toggleSection,
    collapsedProjects,
    toggleProjectCollapse,
    isProjectCollapsed,
    togglePriorityGroupCollapse,
    isPriorityGroupCollapsed,
  }
}
