import { createContext, ReactNode } from 'react'

import { useGlobalHotkeys, GlobalHotkeysApi } from '@/hooks/useGlobalHotkeys'

export const GlobalHotkeysContext = createContext<GlobalHotkeysApi | null>(null)

export function GlobalHotkeysProvider({ children }: { children: ReactNode }) {
  const hotkeys = useGlobalHotkeys()
  return (
    <GlobalHotkeysContext.Provider value={hotkeys}>
      {children}
    </GlobalHotkeysContext.Provider>
  )
}