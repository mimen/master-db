import { Inbox } from "lucide-react"

export function QueueEmptyState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-muted-foreground">
      <div className="flex flex-col items-center gap-2">
        <Inbox className="h-6 w-6 opacity-50" />
        <p className="text-sm">{message}</p>
      </div>
    </div>
  )
}
