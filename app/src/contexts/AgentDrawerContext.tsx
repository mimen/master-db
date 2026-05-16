import { createContext, useCallback, useContext, useMemo, useState } from "react"
import type { ReactNode } from "react"

type AgentDrawerCtx = {
  isOpen: boolean
  activeEntityRef: string | null
  open: (entity_ref: string) => void
  close: () => void
}

const Ctx = createContext<AgentDrawerCtx | null>(null)

export function AgentDrawerProvider({ children }: { children: ReactNode }) {
  const [activeEntityRef, setActiveEntityRef] = useState<string | null>(null)

  const open = useCallback((entity_ref: string) => {
    setActiveEntityRef(entity_ref)
    const url = new URL(window.location.href)
    url.searchParams.set("agent", entity_ref)
    window.history.replaceState({}, "", url.toString())
  }, [])

  const close = useCallback(() => {
    setActiveEntityRef(null)
    const url = new URL(window.location.href)
    url.searchParams.delete("agent")
    window.history.replaceState({}, "", url.toString())
  }, [])

  useMemo(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("agent")
    if (fromUrl) setActiveEntityRef(fromUrl)
  }, [])

  const value: AgentDrawerCtx = { isOpen: activeEntityRef !== null, activeEntityRef, open, close }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAgentDrawer(): AgentDrawerCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error("useAgentDrawer outside AgentDrawerProvider")
  return v
}
