import { cloneElement, isValidElement, type ElementType, type ReactNode } from "react"

import { CountBadge } from "./CountBadge"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface SidebarButtonProps {
  icon?: ElementType<{ className?: string }> | ReactNode
  label: string | ReactNode
  count?: number | null
  isActive: boolean
  onClick: () => void
  colorClass?: string
  level?: number
  children?: ReactNode
}

export function SidebarButton({
  icon,
  label,
  count,
  isActive,
  onClick,
  colorClass,
  level = 0,
  children,
}: SidebarButtonProps) {
  const renderIcon = () => {
    if (!icon) return null

    const iconClassName = cn("h-4 w-4 mr-3", colorClass)

    // Render JSX elements directly while merging class names for styling
    if (isValidElement(icon)) {
      return cloneElement(icon, {
        className: cn(icon.props.className, iconClassName),
      })
    }

    // Otherwise treat the icon as a component type (including forwardRef wrappers)
    const IconComponent = icon as ElementType<{ className?: string }>
    return <IconComponent className={iconClassName} />
  }

  return (
    <Button
      variant="ghost"
      className={cn("w-full justify-start h-8 px-3 text-sm", isActive && "bg-accent")}
      style={level > 0 ? { paddingLeft: `${12 + level * 16}px` } : undefined}
      onClick={onClick}
    >
      {renderIcon()}
      <span className="flex-1 text-left truncate">{label}</span>
      {children}
      {count !== null && count !== undefined && <CountBadge count={count} />}
    </Button>
  )
}
