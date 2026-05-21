export type QueueSort = "urgency" | "recent" | "oldest"

export interface QueueFilterBarProps {
  statuses: string[]
  sort: QueueSort
  onStatusesChange: (statuses: string[]) => void
  onSortChange: (sort: QueueSort) => void
}

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "awaiting_decision", label: "Awaiting decision" },
  { value: "discovering", label: "Thinking" },
  { value: "executing", label: "Running" },
  { value: "error", label: "Error" },
]

const SORT_OPTIONS: Array<{ value: QueueSort; label: string }> = [
  { value: "urgency", label: "Urgency" },
  { value: "recent", label: "Most recent" },
  { value: "oldest", label: "Oldest" },
]

export function QueueFilterBar({
  statuses,
  sort,
  onStatusesChange,
  onSortChange,
}: QueueFilterBarProps) {
  function toggleStatus(value: string) {
    if (statuses.includes(value)) onStatusesChange(statuses.filter((s) => s !== value))
    else onStatusesChange([...statuses, value])
  }

  return (
    <div className="px-3 py-2 border-b flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1 flex-wrap">
        {STATUS_OPTIONS.map((opt) => {
          const active = statuses.includes(opt.value)
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggleStatus(opt.value)}
              className={`text-[11px] rounded-full px-2 py-0.5 border transition-colors ${
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:bg-accent/50"
              }`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
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
    </div>
  )
}
