import { useAction } from "convex/react"
import { useCallback } from "react"
import { ulid } from "ulid"

import { api } from "@/convex/_generated/api"

export function useAgentPost(entity_ref: string) {
  const postRun = useAction(api.agentic.actions.postRun.default)
  const postInterrupt = useAction(api.agentic.actions.postInterrupt.default)

  const send = useCallback(
    async (message: string | null, strategy: "enqueue" | "interrupt" = "enqueue") => {
      return postRun({
        entity_ref,
        message,
        idempotency_key: ulid(),
        multitask_strategy: strategy,
      })
    },
    [entity_ref, postRun],
  )

  const execute = useCallback(
    (option_id: string) => send(`EXECUTE: ${option_id}`, "interrupt"),
    [send],
  )

  const modify = useCallback(
    (option_id: string, text: string) => send(`MODIFY: ${option_id}: ${text}`, "enqueue"),
    [send],
  )

  const interrupt = useCallback(async () => postInterrupt({ entity_ref }), [entity_ref, postInterrupt])

  return { send, execute, modify, interrupt }
}
