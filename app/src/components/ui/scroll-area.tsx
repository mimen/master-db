import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Native-scroll replacement for the Radix ScrollArea primitive.
 *
 * `@radix-ui/react-scroll-area@1.2.10` infinite-loops under React 19: its
 * Root does `useComposedRefs(forwardedRef, (node) => setScrollArea(node))`
 * with a fresh inline ref every render, so React detaches/re-attaches the
 * callback ref each commit (setScrollArea(null) → setScrollArea(node)),
 * re-rendering forever ("Maximum update depth exceeded"). No fixed stable
 * version exists (latest is 1.2.10). We don't need the custom-drawn
 * scrollbar, so this drops the dependency and uses native overflow scroll.
 * API (ScrollArea / ScrollBar) is preserved so callers don't change.
 */
const ScrollArea = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("overflow-y-auto overflow-x-hidden", className)}
    {...props}
  >
    {children}
  </div>
))
ScrollArea.displayName = "ScrollArea"

// Retained for API compatibility; native scrollbars need no element.
const ScrollBar = (_props: React.HTMLAttributes<HTMLDivElement>) => null
ScrollBar.displayName = "ScrollBar"

export { ScrollArea, ScrollBar }
