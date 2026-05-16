import { useExternalStoreRuntime } from "@assistant-ui/react"
import { useQuery } from "convex/react"
import { useMemo } from "react"

import { api } from "@/convex/_generated/api"
import { convertMessage, type ThreadRow } from "@/lib/agent/convertMessage"

export function useAgentRuntime(entity_ref: string | null) {
  const rows = useQuery(
    api.agentic.queries.getThread.default,
    entity_ref ? { entity_ref } : "skip",
  ) as ThreadRow[] | undefined
  const run = useQuery(
    api.agentic.queries.getRun.default,
    entity_ref ? { entity_ref } : "skip",
  )

  const messages = useMemo(
    () => (rows ?? []).map(convertMessage),
    [rows],
  )

  const isRunning = run?.status === "discovering" || run?.status === "executing"

  const runtime = useExternalStoreRuntime({
    messages,
    isRunning,
    convertMessage: (m) => m,
    onNew: async (msg) => {
      // Wired in Task 11 (composer)
      console.warn("[agent] onNew not yet wired", msg)
    },
    onCancel: async () => {
      // Wired in Task 11 (composer Stop)
      console.warn("[agent] onCancel not yet wired")
    },
  })

  return { runtime, rows, run, isRunning, isLoading: rows === undefined || run === undefined }
}
