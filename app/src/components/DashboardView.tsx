import { useQuery } from "convex/react"
import { Flag } from "lucide-react"
import { useMemo } from "react"

import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/convex/_generated/api"
import { getPriorityColorClass } from "@/lib/priorities"
import { cn } from "@/lib/utils"

interface DashboardViewProps {
  listId: string
}

function getTimezoneOffsetMinutes(): number {
  // Browser's getTimezoneOffset() returns positive minutes WEST of UTC,
  // matching the convention used by the dashboard query.
  return new Date().getTimezoneOffset()
}

export function DashboardView({ listId: _listId }: DashboardViewProps) {
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
        />
        <StatCard label="Due today" value={stats.dueToday} />
        <StatCard
          label="Due this week"
          value={stats.dueThisWeek}
          sub="next 7 days"
        />
        <StatCard label="Inbox" value={stats.inbox} sub="unprocessed" />
        <StatCard
          label="P1 active"
          value={stats.p1Active}
          tone={stats.p1Active > 0 ? "alert" : "neutral"}
        />
      </div>

      {/* Row 2: Distribution + Routines */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2">
          <PriorityDistributionCard counts={stats.priorityCounts} />
        </div>
        <RoutinesCard routines={stats.routines} />
      </div>

      {/* Row 3: Top projects + Today's queue */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TopProjectsCard projects={stats.topProjects} />
        <TodayQueueCard items={stats.todayQueue} />
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
}

function StatCard({ label, value, sub, tone = "neutral" }: StatCardProps) {
  return (
    <Card
      className={cn(
        "p-4 flex flex-col gap-1",
        tone === "alert" && "border-red-500/40 bg-red-500/5"
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
}

function PriorityDistributionCard({ counts }: PriorityDistributionCardProps) {
  const max = Math.max(counts.p1, counts.p2, counts.p3, counts.p4, 1)
  const bars = [
    { label: "P1", value: counts.p1, color: "bg-red-500" },
    { label: "P2", value: counts.p2, color: "bg-orange-500" },
    { label: "P3", value: counts.p3, color: "bg-blue-500" },
    { label: "P4", value: counts.p4, color: "bg-muted-foreground/40" },
  ]
  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between mb-4">
        <div className="text-sm font-medium">Priority distribution</div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {counts.total} active
        </div>
      </div>
      <div className="flex items-end gap-3 h-24">
        {bars.map((bar) => {
          const heightPct = (bar.value / max) * 100
          return (
            <div
              key={bar.label}
              className="flex-1 flex flex-col items-center gap-1.5"
            >
              <div className="w-full flex-1 flex items-end">
                <div
                  className={cn("w-full rounded-t-sm", bar.color)}
                  style={{ height: `${Math.max(heightPct, 2)}%` }}
                />
              </div>
              <div className="text-[10px] text-muted-foreground">
                {bar.label}
              </div>
              <div className="text-sm font-medium tabular-nums">
                {bar.value}
              </div>
            </div>
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
}

function RoutinesCard({ routines }: RoutinesCardProps) {
  return (
    <Card className="p-5 flex flex-col gap-3">
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
  }>
}

function TopProjectsCard({ projects }: TopProjectsCardProps) {
  return (
    <Card className="p-5">
      <div className="text-sm font-medium mb-3">Top projects · active tasks</div>
      {projects.length === 0 ? (
        <div className="text-xs text-muted-foreground">No projects with active tasks</div>
      ) : (
        <div className="flex flex-col gap-2">
          {projects.map((project) => (
            <div
              key={project.todoistId}
              className="flex justify-between items-center text-sm"
            >
              <span className="truncate">{project.name}</span>
              <span className="text-muted-foreground tabular-nums ml-2">
                {project.activeTaskCount}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

interface TodayQueueCardProps {
  items: Array<{
    todoistId: string
    content: string
    priority: number
    startTime: string | null
  }>
}

function TodayQueueCard({ items }: TodayQueueCardProps) {
  return (
    <Card className="p-5">
      <div className="text-sm font-medium mb-3">Today · what&apos;s next</div>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          Nothing scheduled for today
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item) => {
            const colorClass = getPriorityColorClass(item.priority)
            const showFlag = item.priority >= 2
            return (
              <div
                key={item.todoistId}
                className="flex justify-between items-center text-sm gap-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {item.startTime ? (
                    <span className="text-muted-foreground tabular-nums text-xs w-10 shrink-0">
                      {item.startTime}
                    </span>
                  ) : (
                    <span className="w-10 shrink-0" />
                  )}
                  <span className="truncate">{item.content}</span>
                </div>
                {showFlag && (
                  <Flag
                    className={cn("h-3.5 w-3.5 shrink-0", colorClass)}
                    fill="currentColor"
                  />
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
