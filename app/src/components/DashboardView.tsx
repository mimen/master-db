import { useQuery } from "convex/react"
import { Flag } from "lucide-react"
import { useMemo } from "react"

import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/convex/_generated/api"
import { getProjectColor } from "@/lib/colors"
import { getPriorityColorClass } from "@/lib/priorities"
import { cn } from "@/lib/utils"
import type { ViewKey } from "@/lib/views/types"

interface DashboardViewProps {
  listId: string
  onNavigate?: (viewKey: ViewKey) => void
}

function getTimezoneOffsetMinutes(): number {
  // Browser's getTimezoneOffset() returns positive minutes WEST of UTC,
  // matching the convention used by the dashboard query.
  return new Date().getTimezoneOffset()
}

export function DashboardView({
  listId: _listId,
  onNavigate,
}: DashboardViewProps) {
  const tzOffset = useMemo(() => getTimezoneOffsetMinutes(), [])
  const stats = useQuery(
    api.dashboard.queries.getDashboardStats.getDashboardStats,
    { timezoneOffsetMinutes: tzOffset }
  )

  if (stats === undefined) {
    return <DashboardSkeleton />
  }

  return (
    <div className="flex flex-col gap-4 p-6 max-w-6xl mx-auto w-full">
      {/* Row 1: Headline counts */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard
          label="Overdue"
          value={stats.overdue}
          tone={stats.overdue > 0 ? "alert" : "neutral"}
          onClick={onNavigate ? () => onNavigate("view:time:overdue") : undefined}
        />
        <StatCard
          label="Due today"
          value={stats.dueToday}
          onClick={onNavigate ? () => onNavigate("view:today") : undefined}
        />
        <StatCard
          label="Due this week"
          value={stats.dueThisWeek}
          sub="next 7 days"
          onClick={onNavigate ? () => onNavigate("view:upcoming") : undefined}
        />
        <StatCard
          label="Inbox"
          value={stats.inbox}
          sub="unprocessed"
          onClick={onNavigate ? () => onNavigate("view:inbox") : undefined}
        />
        <StatCard
          label="P1 active"
          value={stats.p1Active}
          tone={stats.p1Active > 0 ? "alert" : "neutral"}
          onClick={
            onNavigate ? () => onNavigate("view:priority:p1") : undefined
          }
        />
      </div>

      {/* Row 2: Distribution + Routines */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2">
          <PriorityDistributionCard
            counts={stats.priorityCounts}
            onNavigate={onNavigate}
          />
        </div>
        <RoutinesCard
          routines={stats.routines}
          onClick={onNavigate ? () => onNavigate("view:routines") : undefined}
        />
      </div>

      {/* Row 3: Top projects + Focus queue */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TopProjectsCard
          projects={stats.topProjects}
          onNavigate={onNavigate}
        />
        <FocusCard
          items={stats.focusQueue}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Cards

interface StatCardProps {
  label: string
  value: number
  sub?: string
  tone?: "neutral" | "alert"
  onClick?: () => void
}

function StatCard({
  label,
  value,
  sub,
  tone = "neutral",
  onClick,
}: StatCardProps) {
  const clickable = Boolean(onClick)
  return (
    <Card
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onClick?.()
              }
            }
          : undefined
      }
      className={cn(
        "p-4 flex flex-col gap-1",
        tone === "alert" && "border-red-500/40 bg-red-500/5",
        clickable &&
          "cursor-pointer transition-colors hover:bg-accent/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      )}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "text-3xl font-semibold tabular-nums leading-tight",
          tone === "alert" && "text-red-500 dark:text-red-400"
        )}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </Card>
  )
}

interface PriorityDistributionCardProps {
  counts: {
    p1: number
    p2: number
    p3: number
    p4: number
    total: number
  }
  onNavigate?: (viewKey: ViewKey) => void
}

const PRIORITY_VIEW_KEYS: Record<"P1" | "P2" | "P3" | "P4", ViewKey> = {
  P1: "view:priority:p1",
  P2: "view:priority:p2",
  P3: "view:priority:p3",
  P4: "view:priority:p4",
}

function PriorityDistributionCard({
  counts,
  onNavigate,
}: PriorityDistributionCardProps) {
  const max = Math.max(counts.p1, counts.p2, counts.p3, counts.p4, 1)
  const bars = [
    { label: "P1" as const, value: counts.p1, color: "bg-red-500" },
    { label: "P2" as const, value: counts.p2, color: "bg-orange-500" },
    { label: "P3" as const, value: counts.p3, color: "bg-blue-500" },
    { label: "P4" as const, value: counts.p4, color: "bg-muted-foreground/40" },
  ]
  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between mb-4">
        <div className="text-sm font-medium">Priority distribution</div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {counts.total} active
        </div>
      </div>
      <div className="flex items-stretch gap-3 h-40">
        {bars.map((bar) => {
          const heightPct = (bar.value / max) * 100
          const viewKey = PRIORITY_VIEW_KEYS[bar.label]
          const clickable = Boolean(onNavigate)
          return (
            <button
              key={bar.label}
              type="button"
              disabled={!clickable}
              onClick={onNavigate ? () => onNavigate(viewKey) : undefined}
              className={cn(
                "flex-1 h-full flex flex-col items-center justify-end gap-1.5 rounded-md p-1 text-left",
                clickable &&
                  "cursor-pointer transition-colors hover:bg-accent/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                !clickable && "cursor-default"
              )}
            >
              {/* Bar: fixed-position absolute relative to the container is overkill;
                  simpler — give it a percent height of the parent flex column. */}
              <div className="w-full flex-1 flex items-end min-h-0">
                <div
                  className={cn("w-full rounded-t-sm", bar.color)}
                  style={{ height: `${Math.max(heightPct, 4)}%` }}
                />
              </div>
              <div className="text-[10px] text-muted-foreground">
                {bar.label}
              </div>
              <div className="text-sm font-medium tabular-nums">
                {bar.value}
              </div>
            </button>
          )
        })}
      </div>
    </Card>
  )
}

interface RoutinesCardProps {
  routines: {
    active: number
    paused: number
    avgCompletion: number
    overdueRoutineTasks: number
  }
  onClick?: () => void
}

function RoutinesCard({ routines, onClick }: RoutinesCardProps) {
  const clickable = Boolean(onClick)
  return (
    <Card
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onClick?.()
              }
            }
          : undefined
      }
      className={cn(
        "p-5 flex flex-col gap-3",
        clickable &&
          "cursor-pointer transition-colors hover:bg-accent/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      )}
    >
      <div className="text-sm font-medium">Routines</div>
      <div className="flex gap-6 items-baseline">
        <div>
          <div className="text-2xl font-semibold tabular-nums">
            {routines.active}
          </div>
          <div className="text-xs text-muted-foreground">active</div>
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums text-muted-foreground">
            {routines.paused}
          </div>
          <div className="text-xs text-muted-foreground">paused</div>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Avg completion</span>
          <span className="tabular-nums">{routines.avgCompletion}%</span>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500"
            style={{ width: `${routines.avgCompletion}%` }}
          />
        </div>
      </div>
      {routines.overdueRoutineTasks > 0 && (
        <div className="text-xs text-red-500 dark:text-red-400">
          {routines.overdueRoutineTasks} overdue routine task
          {routines.overdueRoutineTasks === 1 ? "" : "s"}
        </div>
      )}
    </Card>
  )
}

interface TopProjectsCardProps {
  projects: Array<{
    todoistId: string
    name: string
    color: string
    activeTaskCount: number
    priority: number | null
    scheduledDate: string | null
  }>
  onNavigate?: (viewKey: ViewKey) => void
}

function TopProjectsCard({ projects, onNavigate }: TopProjectsCardProps) {
  return (
    <Card className="p-5">
      <div className="text-sm font-medium mb-3">Top projects</div>
      {projects.length === 0 ? (
        <div className="text-xs text-muted-foreground">No projects with active tasks</div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {projects.map((project) => {
            const viewKey: ViewKey = `view:project:${project.todoistId}`
            const clickable = Boolean(onNavigate)
            const priorityColor =
              project.priority !== null && project.priority !== undefined
                ? getPriorityColorClass(project.priority)
                : null
            return (
              <button
                key={project.todoistId}
                type="button"
                disabled={!clickable}
                onClick={
                  onNavigate ? () => onNavigate(viewKey) : undefined
                }
                className={cn(
                  "flex items-center gap-2.5 text-sm rounded-md px-2 py-1.5 -mx-2 text-left",
                  clickable &&
                    "cursor-pointer transition-colors hover:bg-accent/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                  !clickable && "cursor-default"
                )}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: getProjectColor(project.color) }}
                  aria-hidden
                />
                <span className="truncate flex-1">{project.name}</span>
                {priorityColor && (
                  <Flag
                    className={cn("h-3.5 w-3.5 shrink-0", priorityColor)}
                    fill="currentColor"
                  />
                )}
                <span className="text-muted-foreground tabular-nums shrink-0 w-10 text-right">
                  {project.activeTaskCount}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </Card>
  )
}

interface FocusCardProps {
  items: Array<{
    todoistId: string
    content: string
    priority: number
    projectName: string | null
    projectColor: string | null
    dueDate: string | null
    isOverdue: boolean
  }>
  onNavigate?: (viewKey: ViewKey) => void
}

function formatDueLabel(item: FocusCardProps["items"][number]): string | null {
  if (!item.dueDate) return null
  if (item.isOverdue) return "overdue"
  const today = new Date().toISOString().slice(0, 10)
  if (item.dueDate === today) return "today"
  // Lightweight relative format: "May 20" or "Aug 3"
  const [, m, d] = item.dueDate.split("-").map((s) => parseInt(s, 10))
  const month = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][m - 1]
  return `${month} ${d}`
}

function FocusCard({ items, onNavigate }: FocusCardProps) {
  const titleClickable = Boolean(onNavigate)
  return (
    <Card className="p-5">
      {titleClickable ? (
        <button
          type="button"
          onClick={() => onNavigate?.("view:priority:p1")}
          className="text-sm font-medium mb-3 text-left rounded-md cursor-pointer hover:text-foreground/80 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          Focus · what&apos;s next →
        </button>
      ) : (
        <div className="text-sm font-medium mb-3">Focus · what&apos;s next</div>
      )}
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          Nothing active. Inbox zero achieved.
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {items.map((item) => {
            const colorClass = getPriorityColorClass(item.priority)
            const showFlag = item.priority >= 2
            const dueLabel = formatDueLabel(item)
            return (
              <div
                key={item.todoistId}
                className="flex items-center gap-2 text-sm px-2 py-1.5 -mx-2"
              >
                {showFlag ? (
                  <Flag
                    className={cn("h-3.5 w-3.5 shrink-0", colorClass)}
                    fill="currentColor"
                  />
                ) : (
                  <span className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="truncate flex-1">{item.content}</span>
                {item.projectName && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0 min-w-0 max-w-[40%]">
                    {item.projectColor && (
                      <span
                        className="h-1.5 w-1.5 rounded-full shrink-0"
                        style={{
                          backgroundColor: getProjectColor(item.projectColor),
                        }}
                        aria-hidden
                      />
                    )}
                    <span className="truncate">{item.projectName}</span>
                  </span>
                )}
                {dueLabel && (
                  <span
                    className={cn(
                      "text-xs shrink-0 tabular-nums w-14 text-right",
                      item.isOverdue
                        ? "text-red-500 dark:text-red-400"
                        : "text-muted-foreground"
                    )}
                  >
                    {dueLabel}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// -----------------------------------------------------------------------------
// Skeleton

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-6 max-w-6xl mx-auto w-full">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Skeleton className="h-44 rounded-lg lg:col-span-2" />
        <Skeleton className="h-44 rounded-lg" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Skeleton className="h-48 rounded-lg" />
        <Skeleton className="h-48 rounded-lg" />
      </div>
    </div>
  )
}
