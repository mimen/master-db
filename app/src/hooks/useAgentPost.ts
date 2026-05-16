import { useCallback } from "react"
import { ulid } from "ulid"

import { postInterrupt, postRun } from "@/lib/agent/engineClient"

export function useAgentPost(entity_ref: string) {
  const send = useCallback(
    async (message: string, strategy: "enqueue" | "interrupt" = "enqueue") => {
      return postRun({
        entity_ref,
        message,
        idempotency_key: ulid(),
        multitask_strategy: strategy,
      })
    },
    [entity_ref],
  )

  const execute = useCallback(
    (option_id: string) => send(`EXECUTE: ${option_id}`, "interrupt"),
    [send],
  )

  const modify = useCallback(
    (option_id: string, text: string) =>
      send(`MODIFY: ${option_id}: ${text}`, "enqueue"),
    [send],
  )

  const interrupt = useCallback(async () => postInterrupt(entity_ref), [entity_ref])

  return { send, execute, modify, interrupt }
}
