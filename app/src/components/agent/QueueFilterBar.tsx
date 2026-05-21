export type QueueSort = "urgency" | "recent" | "oldest"

export type QueueFilterKey =
  | "all-open"
  | "closed"
  | "awaiting_decision"
  | "discovering"
  | "executing"
  | "error"

export interface QueueFilterBarProps {
  filter: QueueFilterKey
  sort: QueueSort
  onFilterChange: (filter: QueueFilterKey) => void
  onSortChange: (sort: QueueSort) => void
}

const PRIMARY_OPTIONS: Array<{ value: QueueFilterKey; label: string }> = [
  { value: "all-open", label: "All open" },
  { value: "closed", label: "Closed" },
]

const STATUS_OPTIONS: Array<{ value: QueueFilterKey; label: string }> = [
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
    <div className="px-3 py-2 border-b flex items-center gap-2 flex-wrap">
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
