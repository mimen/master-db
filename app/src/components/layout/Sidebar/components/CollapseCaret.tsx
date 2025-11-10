import { ChevronRight } from "lucide-react"

import { IconButton } from "./IconButton"
import { useSidebarHover } from "../contexts/SidebarHoverContext"

import { cn } from "@/lib/utils"

interface CollapseCaretProps {
  isCollapsed: boolean
  onToggle: (e: React.MouseEvent) => void
}

export function CollapseCaret({ isCollapsed, onToggle }: CollapseCaretProps) {
  const { isHovered } = useSidebarHover()

  return (
    <IconButton
      onClick={onToggle}
      className={cn("transition-opacity", isHovered ? "opacity-100" : "opacity-0")}
    >
      <ChevronRight
        className={cn("h-3 w-3 transition-transform", !isCollapsed && "rotate-90")}
      />
    </IconButton>
  )
}
