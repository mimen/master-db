import { Flag } from "lucide-react"
import { memo } from "react"

import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { getProjectColor } from "@/lib/colors"
import { usePriority } from "@/lib/priorities"
import { cn } from "@/lib/utils"
import type { TodoistProjectWithMetadata } from "@/types/convex/todoist"

interface ProjectRowProps {
  project: TodoistProjectWithMetadata
  onElementRef: (element: HTMLDivElement | null) => void
  onClick?: () => void
}

export const ProjectRow = memo(function ProjectRow({ project, onElementRef, onClick }: ProjectRowProps) {
  const priority = usePriority(project.metadata?.priority)
  const description = project.metadata?.description
  const activeCount = project.stats.activeCount

  return (
    <div
      ref={onElementRef}
      tabIndex={-1}
      aria-selected={false}
      onClick={onClick}
      data-project-id={project.todoist_id}
      className={cn(
        "group cursor-pointer transition-all duration-150 rounded-md border border-transparent p-2.5",
        "hover:bg-accent/50",
        "focus:outline-none focus:bg-accent/50 focus:border-primary/30"
      )}
    >
      <div className="flex items-start gap-2.5">
        {/* Color Indicator */}
        <div
          className="w-4 h-4 rounded-full shrink-0 mt-0.5"
          style={{ backgroundColor: getProjectColor(project.color) }}
        />

        <div className="flex-1 min-w-0 space-y-1.5">
          {/* Project Name */}
          <div className="font-medium text-sm leading-relaxed break-words">
            {project.name}
          </div>

          {/* Description - shown like tasks do */}
          {description && (
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed break-words">
              {description}
            </p>
          )}

          {/* Badges */}
          <div className="flex flex-wrap items-center gap-1">
            {/* Priority Badge */}
            {priority?.showFlag && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className={cn(
                        "gap-1.5 font-normal",
                        priority.colorClass
                      )}
                    >
                      <Flag className="h-3 w-3" fill="currentColor" />
                      <span>{priority.label}</span>
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    Priority: {priority.label}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {/* Active Tasks Count */}
            {activeCount > 0 && (
              <Badge variant="secondary" className="gap-1.5 font-normal">
                <span className="text-xs">{activeCount} task{activeCount !== 1 ? 's' : ''}</span>
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})
