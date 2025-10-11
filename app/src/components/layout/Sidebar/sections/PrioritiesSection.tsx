import { Flag } from "lucide-react"

import { SidebarButton } from "../components/SidebarButton"

import { cn } from "@/lib/utils"
import type { ViewBuildContext, ViewKey, ViewSelection } from "@/lib/views/types"
import { resolveView } from "@/lib/views/viewDefinitions"

interface PrioritiesSectionProps {
  currentViewKey: ViewKey
  onViewChange: (view: ViewSelection) => void
  viewContext: ViewBuildContext
  mode: "tasks" | "projects"
  onModeChange: (mode: "tasks" | "projects") => void
  counts?: { priorityCounts: { priority: number; filteredTaskCount: number }[] }
}

const PRIORITY_FILTERS = [
  { id: "p1", label: "Priority 1", icon: Flag, color: "text-red-500", priorityLevel: 4 },
  { id: "p2", label: "Priority 2", icon: Flag, color: "text-orange-500", priorityLevel: 3 },
  { id: "p3", label: "Priority 3", icon: Flag, color: "text-blue-500", priorityLevel: 2 },
  { id: "p4", label: "Priority 4", icon: Flag, color: "text-gray-500", priorityLevel: 1 },
] as const

export function PrioritiesSection({
  currentViewKey,
  onViewChange,
  viewContext,
  mode,
  onModeChange,
  counts,
}: PrioritiesSectionProps) {
  return (
    <div className="px-4 pb-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-muted-foreground">Priorities</h3>
      </div>

      <div className="mb-3 flex items-center gap-2 px-1">
        <input
          type="checkbox"
          id="priority-mode"
          checked={mode === "projects"}
          onChange={(e) => onModeChange(e.target.checked ? "projects" : "tasks")}
          className="h-3.5 w-3.5 rounded border-gray-300"
        />
        <label htmlFor="priority-mode" className="text-xs text-muted-foreground cursor-pointer">
          Show as projects
        </label>
      </div>

      <div className="space-y-0.5">
        {PRIORITY_FILTERS.map((priority) => {
          const Icon = priority.icon
          const viewKey = (
            mode === "projects"
              ? `view:priority-projects:${priority.id}`
              : `view:priority:${priority.id}`
          ) as ViewKey
          const isActive = currentViewKey === viewKey
          const count =
            counts?.priorityCounts.find((c) => c.priority === priority.priorityLevel)?.filteredTaskCount || 0

          return (
            <SidebarButton
              key={priority.id}
              icon={<Icon className={cn(priority.color, "h-4 w-4 mr-3")} fill="currentColor" />}
              label={priority.label}
              count={count}
              isActive={isActive}
              onClick={() => onViewChange(resolveView(viewKey, viewContext))}
            />
          )
        })}
      </div>
    </div>
  )
}
