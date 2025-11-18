import type { SVGProps } from "react"

import { cn } from "@/lib/utils"

export interface ProjectTypeIconProps extends SVGProps<SVGSVGElement> {
  size?: "sm" | "md" | "lg"
}

const ICON_SIZES = {
  sm: "h-3 w-3",
  md: "h-4 w-4",
  lg: "h-5 w-5",
} as const

/**
 * Circle icon - represents Areas (ongoing responsibilities)
 */
export function CircleIcon({ size = "md", className, ...props }: ProjectTypeIconProps) {
  const sizeClass = ICON_SIZES[size]

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(sizeClass, className)}
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
    </svg>
  )
}

/**
 * Square icon - represents Projects (finite work)
 */
export function SquareIcon({ size = "md", className, ...props }: ProjectTypeIconProps) {
  const sizeClass = ICON_SIZES[size]

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(sizeClass, className)}
      {...props}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    </svg>
  )
}
