import { AssistantRuntimeProvider, ThreadPrimitive } from "@assistant-ui/react"

import { TranscriptRow } from "./TranscriptRow"
import { WorkLogGroup } from "./WorkLogGroup"

import { useAgentRuntime } from "@/hooks/useAgentRuntime"
import { groupWorkLog } from "@/lib/agent/workLogGrouping"

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
              return (
                <TranscriptRow key={item.row._id} entity_ref={entity_ref} row={item.row} />
              )
            })}
          </div>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  )
}
