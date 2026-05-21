import { ClarificationCard } from "./ClarificationCard"
import { ErrorState } from "./ErrorState"
import { ProposalCard } from "./ProposalCard"

import { Prose } from "@/components/shared/Prose"
import { useAgentPost } from "@/hooks/useAgentPost"
import type { ThreadRow } from "@/lib/agent/convertMessage"
import { isProposal } from "@/lib/agent/proposalToParts"
import { stripProposalTags } from "@/lib/agent/stripProposalTags"

function ErrorRowWrapper({
  entity_ref,
  error,
}: {
  entity_ref: string
  error: { message: string; details?: unknown }
}) {
  const { send } = useAgentPost(entity_ref)
  return <ErrorState entity_ref={entity_ref} error={error} onRetry={() => { void send("") }} />
}

export function TranscriptRow({ entity_ref, row }: { entity_ref: string; row: ThreadRow }) {
  if (row.kind === "user_message") {
    return (
      <div className="ml-auto max-w-[80%] rounded-2xl bg-primary text-primary-foreground px-3 py-2 text-sm">
        {row.body_markdown}
      </div>
    )
  }

  if (row.kind === "assistant_message") {
    return (
      <div className="text-sm">
        <Prose text={stripProposalTags(row.body_markdown ?? "")} />
      </div>
    )
  }

  if (row.kind === "proposal" && isProposal(row.proposal_json)) {
    if (row.proposal_json.kind === "clarification") {
      return <ClarificationCard entity_ref={entity_ref} proposal={row.proposal_json} />
    }
    return (
      <ProposalCard
        entity_ref={entity_ref}
        proposal={row.proposal_json}
        checkpoint_id={row.checkpoint_id ?? null}
      />
    )
  }

  if (row.kind === "execution_result") {
    return (
      <div className="text-sm rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2">
        <div className="flex gap-2">
          <span className="text-emerald-600">✓</span>
          <Prose text={stripProposalTags(row.body_markdown ?? "")} />
        </div>
      </div>
    )
  }

  if (row.kind === "error") {
    const errObj = (row.error_json ?? { message: "Unknown error" }) as {
      message: string
      details?: unknown
    }
    return <ErrorRowWrapper entity_ref={entity_ref} error={errObj} />
  }

  return null
}
