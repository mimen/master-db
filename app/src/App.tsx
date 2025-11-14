import { ConvexProvider, ConvexReactClient } from "convex/react"

import { DialogManager } from "@/components/dialogs/DialogManager"
import { Layout } from "@/components/layout/Layout"
import { SidebarProvider } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { CountProvider } from "@/contexts/CountContext"
import { DialogProvider } from "@/contexts/DialogContext"
import { GlobalHotkeysProvider } from "@/contexts/GlobalHotkeysContext"

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string)

export function App() {
  return (
    <ConvexProvider client={convex}>
      <GlobalHotkeysProvider>
        <CountProvider>
          <DialogProvider>
            <SidebarProvider defaultOpen>
              <Layout />
              <DialogManager />
              <Toaster />
            </SidebarProvider>
          </DialogProvider>
        </CountProvider>
      </GlobalHotkeysProvider>
    </ConvexProvider>
  )
}