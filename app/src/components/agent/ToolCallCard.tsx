import { ChevronDown, ChevronRight } from "lucide-react"
import { type ReactNode, useState } from "react"

import { toolRegistry } from "@/lib/agent/tool-registry"

type Props = {
  name: string
  status: string
  input: unknown
  output: unknown
}

export function ToolCallCard({ name, status, input, output }: Props) {
  const [open, setOpen] = useState(false)

  // Reserved seam: per-tool variants register in toolRegistry
  const Custom = toolRegistry[name as keyof typeof toolRegistry] as
    | ((p: Props) => ReactNode)
    | undefined
  if (Custom) return <>{Custom({ name, status, input, output })}</>

  const statusClass =
    status === "ok" ? "text-emerald-500" :
    status === "error" ? "text-rose-500" :
    "text-amber-500"

  return (
    <div className="rounded-md border bg-card/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1 text-xs hover:bg-accent/50"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span className="font-medium">{name}</span>
        <span className={statusClass}>{status}</span>
      </button>
      {open && (
        <div className="px-2 pb-2 text-[11px] font-mono">
          <div className="text-muted-foreground mt-1">input</div>
          <pre className="overflow-auto bg-muted/30 p-1 rounded">{JSON.stringify(input, null, 2)}</pre>
          <div className="text-muted-foreground mt-1">output</div>
          <pre className="overflow-auto bg-muted/30 p-1 rounded">{JSON.stringify(output, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}
