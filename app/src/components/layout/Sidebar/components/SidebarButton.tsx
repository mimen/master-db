import { cloneElement, isValidElement, type ElementType, type ReactNode } from "react"

import { useSidebarHover } from "../contexts/SidebarHoverContext"

import { CollapseCaret } from "./CollapseCaret"
import { CountBadge } from "./CountBadge"

import { SidebarMenuButton } from "@/components/ui/sidebar"
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
  tooltip?: string
  hasChildren?: boolean
  isCollapsed?: boolean
  onToggleCollapse?: (e: React.MouseEvent) => void
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
  tooltip,
  hasChildren = false,
  isCollapsed = false,
  onToggleCollapse,
}: SidebarButtonProps) {
  const { isHovered } = useSidebarHover()

  const renderIcon = () => {
    if (!icon) return null

    // Render JSX elements directly - preserve their original classes
    if (isValidElement(icon)) {
      // If the element already has sizing classes, don't override them
      // Just add the color class if provided
      if (colorClass && icon.props.className) {
        return cloneElement(icon, {
          className: cn(icon.props.className, colorClass),
        })
      }
      return icon
    }

    // For component types, apply default sizing and color
    const iconClassName = cn("h-4 w-4", colorClass)
    const IconComponent = icon as ElementType<{ className?: string }>
    return <IconComponent className={iconClassName} />
  }

  const hasCaret = hasChildren && onToggleCollapse
  const hasCount = count !== null && count !== undefined

  return (
    <SidebarMenuButton
      isActive={isActive}
      onClick={onClick}
      tooltip={tooltip}
      className={cn(level > 0 && "pl-2")}
      style={level > 0 ? { paddingLeft: `${8 + level * 16}px` } : undefined}
    >
      {renderIcon()}
      <span className="flex-1 truncate min-w-0">{label}</span>
      <div className="flex items-center gap-1 flex-shrink-0">
        {children}
        {(hasCount || hasCaret) && (
          <div className="relative w-6 h-6 flex-shrink-0">
            {hasCount && (
              <div className={cn("absolute inset-0 flex items-center justify-center transition-opacity", hasCaret && isHovered && "opacity-0")}>
                <CountBadge count={count} />
              </div>
            )}
            {hasCaret && (
              <div className="absolute inset-0 flex items-center justify-center">
                <CollapseCaret isCollapsed={isCollapsed} onToggle={onToggleCollapse} />
              </div>
            )}
          </div>
        )}
      </div>
    </SidebarMenuButton>
  )
}
