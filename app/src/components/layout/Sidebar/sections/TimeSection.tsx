import { AlertCircle, Calendar } from "lucide-react"

import { SidebarButton } from "../components/SidebarButton"

import type { ViewBuildContext, ViewKey, ViewSelection } from "@/lib/views/types"
import { resolveView } from "@/lib/views/viewDefinitions"

interface TimeSectionProps {
  currentViewKey: ViewKey
  onViewChange: (view: ViewSelection) => void
  viewContext: ViewBuildContext
  counts?: { timeCounts: { filter: string; filteredTaskCount: number }[] }
}

const TIME_FILTERS = [
  { id: "overdue", label: "Overdue", icon: AlertCircle, color: "text-red-500", filterKey: "overdue" },
  { id: "today", label: "Today", icon: Calendar, color: "text-blue-500", filterKey: "today" },
  { id: "upcoming", label: "Upcoming", icon: Calendar, color: "text-green-500", filterKey: "next7days" },
  { id: "no-date", label: "No Date", icon: Calendar, color: "text-gray-500", filterKey: "nodate" },
] as const

export function TimeSection({ currentViewKey, onViewChange, viewContext, counts }: TimeSectionProps) {
  return (
    <div className="px-4 pb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-muted-foreground">Time</h3>
      </div>
      <div className="space-y-0.5">
        {TIME_FILTERS.map((timeFilter) => {
          const viewKey = `view:time:${timeFilter.id}` as ViewKey
          const isActive = currentViewKey === viewKey
          const count =
            counts?.timeCounts.find((c) => c.filter === timeFilter.filterKey)?.filteredTaskCount || 0

          return (
            <SidebarButton
              key={timeFilter.id}
              icon={timeFilter.icon}
              label={timeFilter.label}
              count={count}
              isActive={isActive}
              onClick={() => onViewChange(resolveView(viewKey, viewContext))}
              colorClass={timeFilter.color}
            />
          )
        })}
      </div>
    </div>
  )
}
