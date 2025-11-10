import { forwardRef, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface IconButtonProps {
  children: ReactNode
  onClick?: (e: React.MouseEvent) => void
  className?: string
  asChild?: boolean
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ children, onClick, className, asChild }, ref) => {
    return (
      <Button
        ref={ref}
        size="sm"
        variant="ghost"
        onClick={onClick}
        asChild={asChild}
        className={cn("h-6 w-6 p-0 flex-shrink-0", className)}
      >
        {children}
      </Button>
    )
  }
)

IconButton.displayName = "IconButton"
