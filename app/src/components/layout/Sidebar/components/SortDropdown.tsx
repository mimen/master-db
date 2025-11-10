import { Check } from "lucide-react"
import { useState, type ElementType } from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

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
  const [open, setOpen] = useState(false)
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
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0 flex-shrink-0"
          onMouseEnter={() => setOpen(true)}
        >
          <CurrentIcon className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onMouseLeave={() => setOpen(false)}>
        {modes.map((mode) => {
          const Icon = getIcon(mode)
          const isActive = mode === currentMode

          return (
            <DropdownMenuItem
              key={mode}
              onClick={() => {
                onChange(mode)
                setOpen(false)
              }}
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
