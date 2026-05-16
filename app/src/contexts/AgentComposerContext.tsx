import { createContext, useContext, useRef, type ReactNode } from "react"

export type ComposerHandle = {
  startModify: (option_id: string, option_label: string) => void
  focus: () => void
}

const Ctx = createContext<ComposerHandle | null>(null)

export function AgentComposerProvider({ children }: { children: ReactNode }) {
  // Mutable ref reassigned by AgentComposer on mount (see Task 11).
  const ref = useRef<ComposerHandle | null>(null)
  return <Ctx.Provider value={{
    startModify: (id, label) => ref.current?.startModify(id, label),
    focus: () => ref.current?.focus(),
  }}>{children}</Ctx.Provider>
}

export function useAgentComposerHandle(): ComposerHandle | null {
  return useContext(Ctx)
}
