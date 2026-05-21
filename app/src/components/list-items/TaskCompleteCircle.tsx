import { Check, RefreshCw } from "lucide-react"
import type { MouseEvent } from "react"

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export interface TaskCompleteCircleProps {
  /** Completed state — renders the filled / checked look. */
  checked?: boolean
  /** Priority color class, e.g. "text-red-500" — drives the ring/border color. */
  priorityColorClass?: string | null
  /** Routine-task styling variant (refresh icon + skip affordance). */
  isRoutine?: boolean
  /** Click handler — caller owns completion + stopPropagation. */
  onToggle: (event: MouseEvent) => void
  /** Circle diameter in px. Defaults to 17 (the task-list size). */
  size?: number
  /** Optional tooltip label; omit to render without a tooltip wrapper. */
  tooltip?: string
}

const DEFAULT_SIZE = 17

export function TaskCompleteCircle({
  checked = false,
  priorityColorClass = null,
  isRoutine = false,
  onToggle,
  size = DEFAULT_SIZE,
  tooltip
}: TaskCompleteCircleProps) {
  const ariaLabel = tooltip ?? (isRoutine ? "Complete routine task" : "Complete task")

  const isDefaultSize = size === DEFAULT_SIZE

  const button = (
    <button
      onClick={onToggle}
      style={isDefaultSize ? undefined : { height: size, width: size }}
      className={cn(
        "group/checkbox mt-0.5 flex shrink-0 items-center justify-center rounded-full relative",
        isDefaultSize && "h-[17px] w-[17px]",
        "transition-colors transition-opacity duration-150",
        "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        isRoutine
          ? "border-transparent hover:border"
          : "border ring-1",
        isRoutine && priorityColorClass === "text-red-500"
          ? "text-red-500 hover:bg-red-500 hover:border-red-500/60 hover:ring-1 hover:ring-red-500"
          : isRoutine && priorityColorClass === "text-orange-500"
          ? "text-orange-500 hover:bg-orange-500 hover:border-orange-500/60 hover:ring-1 hover:ring-orange-500"
          : isRoutine && priorityColorClass === "text-blue-500"
          ? "text-blue-500 hover:bg-blue-500 hover:border-blue-500/60 hover:ring-1 hover:ring-blue-500"
          : isRoutine
          ? "text-foreground/60 hover:bg-foreground/80 hover:border-foreground hover:ring-1 hover:ring-foreground/60"
          : !isRoutine && priorityColorClass === "text-red-500"
          ? "text-red-500 border-red-500/60 ring-red-500 hover:bg-red-500 hover:ring-red-500/10"
          : !isRoutine && priorityColorClass === "text-orange-500"
          ? "text-orange-500 border-orange-500/60 ring-orange-500 hover:bg-orange-500 hover:ring-orange-500/10"
          : !isRoutine && priorityColorClass === "text-blue-500"
          ? "text-blue-500 border-blue-500/60 ring-blue-500 hover:bg-blue-500 hover:ring-blue-500/10"
          : !isRoutine && "border-foreground/20 ring-foreground/60 hover:border-foreground hover:bg-foreground/80 hover:ring-foreground/10",
        checked && "bg-current"
      )}
      aria-label={ariaLabel}
      aria-pressed={checked || undefined}
    >
      {isRoutine ? (
        <>
          <RefreshCw
            className={cn(
              "h-[21px] w-[21px] absolute left-1/2 top-1/2 translate-x-[-11px] -translate-y-1/2 transition-opacity duration-150 group-hover/checkbox:opacity-0",
              checked && "opacity-0"
            )}
            strokeWidth={2}
          />
          <Check
            className={cn(
              "h-3 w-3 text-background absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 transition-opacity duration-150 group-hover/checkbox:opacity-100",
              checked ? "opacity-100" : "opacity-0"
            )}
            strokeWidth={3}
          />
        </>
      ) : (
        <Check
          className={cn(
            "h-3 w-3 text-background transition-opacity duration-150 group-hover/checkbox:opacity-100",
            checked ? "opacity-100" : "opacity-0"
          )}
          strokeWidth={3}
        />
      )}
    </button>
  )

  if (!tooltip) return button

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
