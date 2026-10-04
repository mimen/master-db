import { lazy, Suspense } from "react"

// The agent surface carries @assistant-ui/react; load it only when a thread opens.
const AgentSurface = lazy(() => import("./AgentSurface").then((m) => ({ default: m.AgentSurface })))

export function LazyAgentSurface({ entity_ref }: { entity_ref: string }) {
  return (
    <Suspense fallback={null}>
      <AgentSurface entity_ref={entity_ref} />
    </Suspense>
  )
}
