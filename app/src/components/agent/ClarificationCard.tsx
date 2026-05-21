import { useEffect } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { Button } from "@/components/ui/button"
import { useAgentComposerHandle } from "@/contexts/AgentComposerContext"
import { useAgentPost } from "@/hooks/useAgentPost"
import type { Proposal } from "@/lib/agent/proposalToParts"

type Props = {
  entity_ref: string
  proposal: Proposal
}

export function ClarificationCard({ entity_ref, proposal }: Props) {
  const { send } = useAgentPost(entity_ref)
  const composer = useAgentComposerHandle()

  // Make the free-text composer the primary affordance: focus it when a
  // clarification appears. No-op if the composer hasn't registered yet.
  useEffect(() => {
    composer?.focus()
  }, [composer])

  const question = proposal.question ?? proposal.summary
  const showSummary = proposal.summary !== "" && proposal.summary !== question

  return (
    <div
      className="rounded-lg border border-sky-500/40 bg-sky-500/5 p-4 space-y-3"
      data-testid="clarification-card"
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-600">
        Needs your input
      </div>
      <h3 className="text-base font-semibold leading-snug">{question}</h3>

      {showSummary && (
        <div className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{proposal.summary}</ReactMarkdown>
        </div>
      )}

      {proposal.options.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Common answers
          </div>
          <div className="flex flex-wrap gap-2">
            {proposal.options.map((o) => (
              <Button
                key={o.id}
                size="sm"
                variant="outline"
                className="h-auto py-1"
                onClick={() => void send(o.label)}
              >
                {o.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        className="text-xs font-medium text-sky-600 hover:text-sky-700 hover:underline"
        onClick={() => composer?.focus()}
      >
        Type my own answer →
      </button>
    </div>
  )
}
