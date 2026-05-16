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

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="prose prose-sm dark:prose-invert max-w-none mb-2">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{proposal.summary}</ReactMarkdown>
      </div>
      {proposal.findings && proposal.findings.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Receipts
          </div>
          <ul className="list-disc list-inside text-xs text-muted-foreground space-y-0.5">
            {proposal.findings.map((f) => <li key={f}>{f}</li>)}
          </ul>
        </div>
      )}
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
      {checkpoint_id && (
        <div className="mt-3 flex justify-end">
          <RewindButton checkpoint_id={checkpoint_id} />
        </div>
      )}
    </div>
  )
}
