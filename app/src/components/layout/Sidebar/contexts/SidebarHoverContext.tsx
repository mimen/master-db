import { createContext, useContext, useState, type ReactNode } from "react"

interface SidebarHoverContextType {
  isHovered: boolean
  setIsHovered: (hovered: boolean) => void
}

const SidebarHoverContext = createContext<SidebarHoverContextType | undefined>(undefined)

export function SidebarHoverProvider({ children }: { children: ReactNode }) {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <SidebarHoverContext.Provider value={{ isHovered, setIsHovered }}>
      {children}
    </SidebarHoverContext.Provider>
  )
}

export function useSidebarHover() {
  const context = useContext(SidebarHoverContext)
  if (!context) {
    throw new Error("useSidebarHover must be used within SidebarHoverProvider")
  }
  return context
}
