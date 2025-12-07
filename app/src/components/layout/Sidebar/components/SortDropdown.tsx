import { Check } from "lucide-react"
import { type ElementType } from "react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

interface SortDropdownProps<T extends string> {
  modes: readonly T[]
  currentMode: T
  onChange: (mode: T) => void
  getIcon: (mode: T) => ElementType<{ className?: string }>
  getLabel?: (mode: T) => string
}

export function SortDropdown<T extends string>({
  modes,
  currentMode,
  onChange,
  getIcon,
  getLabel,
}: SortDropdownProps<T>) {
  const CurrentIcon = getIcon(currentMode)

  const formatLabel = (mode: T): string => {
    if (getLabel) return getLabel(mode)
    // Convert camelCase/PascalCase to Title Case with spaces
    return mode
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (str) => str.toUpperCase())
      .trim()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <div
          className={cn(
            "h-6 w-6 p-0 flex-shrink-0 flex items-center justify-center",
            "rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            "cursor-pointer transition-colors"
          )}
          role="button"
          tabIndex={0}
          aria-label="Sort options"
        >
          <CurrentIcon className="h-2.5 w-2.5" />
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {modes.map((mode) => {
          const Icon = getIcon(mode)
          const isActive = mode === currentMode

          return (
            <DropdownMenuItem
              key={mode}
              onClick={() => onChange(mode)}
              className="cursor-pointer text-xs py-1"
            >
              <Icon className="h-3 w-3 mr-2" />
              <span className="flex-1">{formatLabel(mode)}</span>
              {isActive && <Check className="h-3 w-3 ml-2" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
