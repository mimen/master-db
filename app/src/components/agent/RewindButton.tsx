import { Undo2 } from "lucide-react"
import { toast } from "sonner"

export function RewindButton({ checkpoint_id }: { checkpoint_id: string }) {
  return (
    <button
      type="button"
      onClick={() => toast.info(`Rewind not yet available — coming in Phase 2. (checkpoint ${checkpoint_id})`)}
      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
    >
      <Undo2 className="h-3 w-3" />
      Rewind here
    </button>
  )
}
