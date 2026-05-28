import { STATUS_LABEL } from "@/lib/agent/statusMeta"

export type QueueSort = "urgency" | "recent" | "oldest"

export type QueueFilterKey =
  | "all-open"
  | "closed"
  | "awaiting_decision"
  | "discovering"
  | "executing"
  | "error"

/**
 * The agent-mode filter dimension extends the queue's single-select with
 * `"no-run"` (tasks that never had an agentic run). Mirrors `AgentFilterKey`
 * in `@/lib/agent/agentOverlay`; declared inline here to avoid a circular
 * import (agentOverlay imports `QueueFilterKey` from this module).
 */
type BarFilterKey = QueueFilterKey | "no-run"

export interface QueueFilterBarProps {
  filter: BarFilterKey
  onFilterChange: (filter: BarFilterKey) => void
  /**
   * Sort control is optional. When `sort`/`onSortChange` are omitted (the
   * agent-mode filter-only variant), the sort `<select>` is not rendered and
   * BaseListView's own sort dropdown owns sorting instead.
   */
  sort?: QueueSort
  onSortChange?: (sort: QueueSort) => void
}

const PRIMARY_OPTIONS: Array<{ value: BarFilterKey; label: string }> = [
  { value: "all-open", label: "All open" },
  { value: "closed", label: "Closed" },
  { value: "no-run", label: "No run" },
]

const STATUS_OPTIONS: Array<{ value: BarFilterKey; label: string }> = [
  { value: "awaiting_decision", label: STATUS_LABEL.awaiting_decision },
  { value: "discovering", label: STATUS_LABEL.discovering },
  { value: "executing", label: STATUS_LABEL.executing },
  { value: "error", label: STATUS_LABEL.error },
]

const SORT_OPTIONS: Array<{ value: QueueSort; label: string }> = [
  { value: "urgency", label: "Urgency" },
  { value: "recent", label: "Most recent" },
  { value: "oldest", label: "Oldest" },
]

function chipClass(active: boolean): string {
  return `text-[11px] rounded-full px-2 py-0.5 border transition-colors ${
    active
      ? "bg-primary text-primary-foreground border-primary"
      : "border-border text-muted-foreground hover:bg-accent/50"
  }`
}

export function QueueFilterBar({
  filter,
  sort,
  onFilterChange,
  onSortChange,
}: QueueFilterBarProps) {
  return (
    <div className="px-3 py-2 flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1 flex-wrap">
        {PRIMARY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onFilterChange(opt.value)}
            className={chipClass(filter === opt.value)}
          >
            {opt.label}
          </button>
        ))}
        <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onFilterChange(opt.value)}
            className={chipClass(filter === opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {sort !== undefined && onSortChange ? (
        <div className="ml-auto">
          <label className="text-[11px] text-muted-foreground mr-1" htmlFor="queue-sort">
            Sort
          </label>
          <select
            id="queue-sort"
            aria-label="Sort"
            value={sort}
            onChange={(e) => onSortChange(e.target.value as QueueSort)}
            className="text-[11px] rounded-md border bg-background px-1.5 py-0.5"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  )
}
