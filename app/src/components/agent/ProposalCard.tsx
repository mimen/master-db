import { ChevronRight } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { ProposalOptionRow } from "./ProposalOptionRow"
import { RewindButton } from "./RewindButton"

import { useAgentComposerHandle } from "@/contexts/AgentComposerContext"
import { useAgentPost } from "@/hooks/useAgentPost"
import type { Proposal } from "@/lib/agent/proposalToParts"

type Props = {
  entity_ref: string
  proposal: Proposal
  checkpoint_id: string | null
}

export function ProposalCard({ entity_ref, proposal, checkpoint_id }: Props) {
  const { execute } = useAgentPost(entity_ref)
  const composer = useAgentComposerHandle()
  const optionCount = proposal.options.length

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      {/* Section 1: Summary — always visible */}
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{proposal.summary}</ReactMarkdown>
      </div>

      {/* Section 2: Receipts — collapsed by default */}
      {proposal.findings && proposal.findings.length > 0 && (
        <details className="group border-t pt-3">
          <summary
            className="cursor-pointer list-none flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden"
            data-testid="receipts-toggle"
          >
            <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
            Receipts ({proposal.findings.length})
          </summary>
          <ul className="mt-2 list-disc list-inside text-xs text-muted-foreground space-y-0.5">
            {proposal.findings.map((f) => <li key={f}>{f}</li>)}
          </ul>
        </details>
      )}

      {/* Section 3: Decision — visually distinct */}
      <div className="border-t pt-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Decision · {optionCount} option{optionCount === 1 ? "" : "s"}
        </div>
        <div className="space-y-2">
          {proposal.options.map((o) => (
            <ProposalOptionRow
              key={o.id}
              option={o}
              recommended={o.id === proposal.recommended_option_id}
              onExecute={(id) => execute(id)}
              onModify={(id) => composer?.startModify(id, o.label)}
            />
          ))}
        </div>
      </div>

      {checkpoint_id && (
        <div className="flex justify-end">
          <RewindButton checkpoint_id={checkpoint_id} />
        </div>
      )}
    </div>
  )
}
