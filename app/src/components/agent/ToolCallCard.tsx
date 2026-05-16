import { ChevronDown, ChevronRight } from "lucide-react"
import { type ReactNode, useState } from "react"

import { toolRegistry } from "@/lib/agent/tool-registry"

type Props = {
  name: string
  status: string
  input: unknown
  output: unknown
}

function previewFromInput(name: string, input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null
  const i = input as Record<string, unknown>
  const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s)
  switch (name) {
    case "Skill":     return typeof i.skill === "string" ? `: ${i.skill}` : null
    case "Bash":      return typeof i.command === "string" ? `: ${truncate(i.command, 60)}` : null
    case "Read":      return typeof i.file_path === "string" ? `: ${i.file_path}`
                          : typeof i.path === "string" ? `: ${i.path}` : null
    case "Grep":      return typeof i.pattern === "string" ? `: ${i.pattern}` : null
    case "Edit":
    case "Write":     return typeof i.file_path === "string" ? `: ${i.file_path}` : null
    case "WebFetch":  return typeof i.url === "string" ? `: ${truncate(i.url, 50)}` : null
    case "WebSearch": return typeof i.query === "string" ? `: ${i.query}` : null
    default:          return null
  }
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

  const preview = previewFromInput(name, input)

  return (
    <div className="rounded-md border bg-card/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1 text-xs hover:bg-accent/50"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span className="font-medium">{name}</span>
        {preview && <span className="text-muted-foreground truncate">{preview}</span>}
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
