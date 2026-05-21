import { AlertCircle, Bot, Calendar } from "lucide-react"

import { StatusPill } from "./StatusPill"

import { DateBadge, LabelBadge, PriorityBadge, ProjectBadge } from "@/components/badges/shared"
import { MarkdownLinkText } from "@/components/shared/MarkdownLinkText"
import { getProjectColor } from "@/lib/colors"
import { formatSmartDate } from "@/lib/dateFormatters"
import { usePriority } from "@/lib/priorities"

export interface QueueRowItem {
  entity_ref: string
  entity_type: string
  entity_title: string
  status: string
  last_urgency: number | null | undefined
  updated_at: number
  priority: number | null
  due: string | null
  deadline: string | null
  labels: Array<{ name: string; color: string }>
  project: { name: string; color: string } | null
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function urgencyClass(u: number): string {
  if (u >= 0.85) return "bg-rose-500/15 text-rose-600 border-rose-500/30"
  if (u >= 0.5) return "bg-amber-500/15 text-amber-700 border-amber-500/30"
  return "bg-muted text-muted-foreground border-border"
}

export function QueueRow({
  item,
  focused,
  onFocus,
  showStatus = true,
}: {
  item: QueueRowItem
  focused: boolean
  onFocus: (entity_ref: string) => void
  showStatus?: boolean
}) {
  const urgency = item.last_urgency
  const priority = usePriority(item.priority ?? undefined)
  // Derive shared date chips, mirroring AgentSurface/TaskListItem: due uses the
  // Calendar icon, deadline uses AlertCircle; status comes from formatSmartDate.
  const dueInfo = item.due ? formatSmartDate(item.due) : null
  const deadlineInfo = item.deadline ? formatSmartDate(item.deadline) : null
  return (
    <button
      type="button"
      onClick={() => onFocus(item.entity_ref)}
      className={`w-full text-left px-3 py-2 border-l-2 hover:bg-accent/40 transition-colors flex flex-col ${
        focused ? "bg-accent/60 border-l-primary" : "border-l-transparent"
      }`}
    >
      {/* Line 1: triage signal */}
      <div className="flex items-center gap-2">
        <Bot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="flex-1 truncate text-sm">
          <MarkdownLinkText text={item.entity_title} />
        </span>
        {urgency != null && (
          <span
            className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold shrink-0 ${urgencyClass(urgency)}`}
          >
            {urgency.toFixed(2)}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground shrink-0 w-14 text-right">
          {relativeTime(item.updated_at)}
        </span>
      </div>

      {/* Line 2: metadata */}
      <div className="flex flex-wrap items-center gap-1.5 min-w-0 pl-5 mt-0.5">
        {showStatus && <StatusPill status={item.status} />}
        {item.project && (
          <ProjectBadge
            project={{
              name: item.project.name,
              color: getProjectColor(item.project.color),
            }}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        {priority?.showFlag && (
          <PriorityBadge priority={priority} onClick={(e) => e.stopPropagation()} />
        )}
        {dueInfo && (
          <DateBadge
            date={dueInfo.text}
            status={
              dueInfo.isOverdue ? "overdue" :
              dueInfo.isToday ? "today" :
              dueInfo.isTomorrow ? "tomorrow" :
              "future"
            }
            icon={Calendar}
            onClick={(e) => e.stopPropagation()}
            showRemoveButton={false}
          />
        )}
        {deadlineInfo && (
          <DateBadge
            date={deadlineInfo.text}
            status={
              deadlineInfo.isOverdue ? "overdue" :
              deadlineInfo.isToday ? "today" :
              "future"
            }
            icon={AlertCircle}
            onClick={(e) => e.stopPropagation()}
            showRemoveButton={false}
          />
        )}
        {item.labels
          .filter((label) => label.name !== "routine")
          .map((label) => {
            const color = getProjectColor(label.color)
            return (
              <LabelBadge
                key={label.name}
                label={{
                  name: label.name,
                  borderColor: `${color}40`,
                  backgroundColor: `${color}15`,
                }}
                onClick={(e) => e.stopPropagation()}
              />
            )
          })}
      </div>
    </button>
  )
}
