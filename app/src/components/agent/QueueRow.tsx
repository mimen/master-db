import { Bot } from "lucide-react"

import { StatusPill } from "./StatusPill"

export interface QueueRowItem {
  entity_ref: string
  entity_type: string
  entity_title: string
  status: string
  last_urgency: number | null | undefined
  updated_at: number
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
}: {
  item: QueueRowItem
  focused: boolean
  onFocus: (entity_ref: string) => void
}) {
  const urgency = item.last_urgency
  return (
    <button
      type="button"
      onClick={() => onFocus(item.entity_ref)}
      className={`w-full text-left px-3 py-2 border-l-2 hover:bg-accent/40 transition-colors flex items-center gap-2 ${
        focused ? "bg-accent/60 border-l-primary" : "border-l-transparent"
      }`}
    >
      <Bot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="flex-1 truncate text-sm">{item.entity_title}</span>
      <StatusPill status={item.status} />
      {urgency != null && (
        <span
          className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${urgencyClass(urgency)}`}
        >
          {urgency.toFixed(2)}
        </span>
      )}
      <span className="text-[10px] text-muted-foreground shrink-0 w-14 text-right">
        {relativeTime(item.updated_at)}
      </span>
    </button>
  )
}
