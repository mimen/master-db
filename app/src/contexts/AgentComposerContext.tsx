import { createContext, useContext, useMemo, useRef, type ReactNode } from "react"

export type ComposerHandle = {
  startModify: (option_id: string, option_label: string) => void
  focus: () => void
}

type Ctx = {
  getHandle: () => ComposerHandle | null
  register: (h: ComposerHandle | null) => void
}

const ComposerCtx = createContext<Ctx | null>(null)

export function AgentComposerProvider({ children }: { children: ReactNode }) {
  const ref = useRef<ComposerHandle | null>(null)
  const value = useMemo<Ctx>(() => ({
    getHandle: () => ref.current,
    register: (h) => { ref.current = h },
  }), [])
  return <ComposerCtx.Provider value={value}>{children}</ComposerCtx.Provider>
}

export function useAgentComposerHandle(): ComposerHandle | null {
  const c = useContext(ComposerCtx)
  return c?.getHandle() ?? null
}

export function useRegisterComposer(): (h: ComposerHandle | null) => void {
  const c = useContext(ComposerCtx)
  if (!c) throw new Error("AgentComposer must be inside AgentComposerProvider")
  return c.register
}
