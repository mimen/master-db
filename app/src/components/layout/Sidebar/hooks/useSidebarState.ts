import { useCallback, useState } from "react"

import type { ProjectSort, LabelSort } from "../types"

export function useSidebarState() {
  const [expandNested, setExpandNested] = useState(false)
  const [priorityMode, setPriorityMode] = useState<"tasks" | "projects">("tasks")
  const [projectSort, setProjectSort] = useState<ProjectSort>("hierarchy")
  const [labelSort, setLabelSort] = useState<LabelSort>("taskCount")

  const cycleProjectSort = useCallback(() => {
    const sorts: ProjectSort[] = ["hierarchy", "priority", "taskCount", "alphabetical"]
    const currentIndex = sorts.indexOf(projectSort)
    const nextIndex = (currentIndex + 1) % sorts.length
    setProjectSort(sorts[nextIndex])
  }, [projectSort])

  const cycleLabelSort = useCallback(() => {
    const sorts: LabelSort[] = ["taskCount", "alphabetical"]
    const currentIndex = sorts.indexOf(labelSort)
    const nextIndex = (currentIndex + 1) % sorts.length
    setLabelSort(sorts[nextIndex])
  }, [labelSort])

  const togglePriorityMode = useCallback(() => {
    setPriorityMode((prev) => (prev === "tasks" ? "projects" : "tasks"))
  }, [])

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
  }
}
