import { ChevronRight } from "lucide-react"
import type { MouseEvent } from "react"

import { useSidebarHover } from "../contexts/SidebarHoverContext"

import { cn } from "@/lib/utils"

interface CollapseCaretProps {
  isCollapsed: boolean
  onToggle: (e: MouseEvent) => void
}

export function CollapseCaret({ isCollapsed, onToggle }: CollapseCaretProps) {
  const { isHovered } = useSidebarHover()

  return (
    <div
      onClick={onToggle}
      className={cn(
        "h-6 w-6 p-0 flex-shrink-0 flex items-center justify-center cursor-pointer rounded-md hover:bg-accent transition-opacity",
        isHovered ? "opacity-100" : "opacity-0"
      )}
    >
      <ChevronRight
        className={cn("h-3 w-3 transition-transform", !isCollapsed && "rotate-90")}
      />
    </div>
  )
}
