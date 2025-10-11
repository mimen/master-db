import type { ComponentType } from "react"

interface SortToggleProps<T extends string> {
  modes: readonly T[]
  currentMode: T
  onToggle: (nextMode: T) => void
  getIcon: (mode: T) => ComponentType<{ className?: string }>
  title?: string
}

export function SortToggle<T extends string>({
  modes,
  currentMode,
  onToggle,
  getIcon,
  title,
}: SortToggleProps<T>) {
  const handleClick = () => {
    const currentIndex = modes.indexOf(currentMode)
    const nextIndex = (currentIndex + 1) % modes.length
    onToggle(modes[nextIndex])
  }

  const Icon = getIcon(currentMode)

  return (
    <button
      onClick={handleClick}
      className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted transition-colors"
      title={title || `Sort: ${currentMode}`}
    >
      <Icon className="h-3 w-3 text-muted-foreground" />
    </button>
  )
}
