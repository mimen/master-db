import { useState } from "react"

import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useAgentComposerHandle } from "@/contexts/AgentComposerContext"

export type AgentError = { message: string; details?: unknown }

export function ErrorState({
  entity_ref: _entity_ref,
  error,
  onRetry,
}: {
  entity_ref: string
  error: AgentError
  onRetry: () => void
}) {
  const [open, setOpen] = useState(false)
  const composer = useAgentComposerHandle()
  return (
    <div className="rounded-md border-l-4 border-l-rose-500 border border-border bg-rose-500/5 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-rose-500 mt-0.5 shrink-0" />
        <div className="flex-1 text-sm">
          <div className="font-medium">{error.message}</div>
          {error.details !== undefined && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground"
            >
              {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              details
            </button>
          )}
          {open && (
            <pre className="mt-1 overflow-auto bg-background/60 p-2 rounded text-[11px] font-mono">
              {JSON.stringify(error.details, null, 2)}
            </pre>
          )}
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
        <Button size="sm" variant="ghost" onClick={() => composer?.focus()}>Ask the agent</Button>
      </div>
    </div>
  )
}
