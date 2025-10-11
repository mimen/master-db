interface CountBadgeProps {
  count: number
}

export function CountBadge({ count }: CountBadgeProps) {
  if (count <= 0) return null

  return (
    <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5 min-w-6 text-center">
      {count}
    </span>
  )
}
