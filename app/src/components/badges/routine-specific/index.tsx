import { Edit, Info, Pause, Play } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface BaseBadgeProps {
  onClick: (e: React.MouseEvent) => void
  isGhost?: boolean
}

interface DetailsBadgeProps extends BaseBadgeProps {
  completionRate: number
  colorClass?: string
}

export function DetailsBadge({ completionRate, onClick, colorClass }: DetailsBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-normal cursor-pointer hover:bg-accent/80 transition-colors",
        colorClass
      )}
      onClick={onClick}
    >
      <Info className="h-3 w-3" />
      <span>{completionRate}%</span>
    </Badge>
  )
}

interface EditBadgeProps extends BaseBadgeProps {
  text?: string
}

export function EditBadge({ onClick, text = "Edit" }: EditBadgeProps) {
  return (
    <Badge
      variant="outline"
      className="gap-1.5 font-normal cursor-pointer hover:bg-accent/80 transition-colors text-muted-foreground border-dashed"
      onClick={onClick}
    >
      <Edit className="h-3 w-3" />
      <span>{text}</span>
    </Badge>
  )
}


interface PauseBadgeProps extends BaseBadgeProps {
  isPaused: boolean
}

export function PauseBadge({ isPaused, onClick }: PauseBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-normal cursor-pointer hover:bg-accent/80 transition-colors",
        isPaused ? "text-yellow-600 border-yellow-600" : "text-muted-foreground"
      )}
      onClick={onClick}
    >
      {isPaused ? (
        <>
          <Pause className="h-3 w-3" fill="currentColor" />
          <span>Paused</span>
        </>
      ) : (
        <>
          <Play className="h-3 w-3" fill="currentColor" />
          <span>Resume</span>
        </>
      )}
    </Badge>
  )
}
