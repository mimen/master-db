import { AssistantRuntimeProvider, ThreadPrimitive } from "@assistant-ui/react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { ErrorState } from "./ErrorState"
import { ProposalCard } from "./ProposalCard"
import { WorkLogGroup } from "./WorkLogGroup"

import { useAgentPost } from "@/hooks/useAgentPost"
import { useAgentRuntime } from "@/hooks/useAgentRuntime"
import { isProposal } from "@/lib/agent/proposalToParts"
import { stripProposalTags } from "@/lib/agent/stripProposalTags"
import { groupWorkLog } from "@/lib/agent/workLogGrouping"

function Prose({ text }: { text: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}

export function AgentTranscript({ entity_ref }: { entity_ref: string }) {
  const { runtime, rows, isLoading } = useAgentRuntime(entity_ref)
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  const grouped = groupWorkLog(rows ?? [])
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="flex flex-col gap-3">
        <ThreadPrimitive.Viewport>
          <div className="flex flex-col gap-3">
          {grouped.map((item) => {
            if (item.type === "group") {
              return (
                <WorkLogGroup
                  key={`g-${item.firstSequence}`}
                  items={item.items}
                  firstSequence={item.firstSequence}
                  lastSequence={item.lastSequence}
                  run_id={item.run_id}
                />
              )
            }
            const r = item.row
            if (r.kind === "user_message") {
              return (
                <div
                  key={r._id}
                  className="ml-auto max-w-[80%] rounded-2xl bg-primary text-primary-foreground px-3 py-2 text-sm"
                >
                  {r.body_markdown}
                </div>
              )
            }
            if (r.kind === "assistant_message") {
              return (
                <div key={r._id} className="text-sm">
                  <Prose text={stripProposalTags(r.body_markdown ?? "")} />
                </div>
              )
            }
            if (r.kind === "proposal" && isProposal(r.proposal_json)) {
              return (
                <ProposalCard
                  key={r._id}
                  entity_ref={entity_ref}
                  proposal={r.proposal_json}
                  checkpoint_id={r.checkpoint_id ?? null}
                />
              )
            }
            if (r.kind === "execution_result") {
              return (
                <div key={r._id} className="text-sm rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2">
                  ✓ {stripProposalTags(r.body_markdown ?? "")}
                </div>
              )
            }
            if (r.kind === "error") {
              const errObj = (r.error_json ?? { message: "Unknown error" }) as { message: string; details?: unknown }
              return (
                <ErrorRowWrapper key={r._id} entity_ref={entity_ref} error={errObj} />
              )
            }
            return null
          })}
          </div>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  )
}

function ErrorRowWrapper({ entity_ref, error }: { entity_ref: string; error: { message: string; details?: unknown } }) {
  const { send } = useAgentPost(entity_ref)
  return (
    <ErrorState
      entity_ref={entity_ref}
      error={error}
      onRetry={() => { void send("") }}
    />
  )
}
