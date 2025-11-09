import { Badge } from "@/components/ui/badge"

interface CountBadgeProps {
  count: number
}

export function CountBadge({ count }: CountBadgeProps) {
  if (count <= 0) return null

  return (
    <Badge variant="secondary" className="h-4 px-1.5 py-0 text-[10px] tabular-nums min-w-5 justify-center flex-shrink-0">
      {count}
    </Badge>
  )
}
