import { ConvexProvider, ConvexReactClient } from "convex/react"
import { ThemeProvider } from "next-themes"

import { DialogManager } from "@/components/dialogs/DialogManager"
import { Layout } from "@/components/layout/Layout"
import { SidebarProvider } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { CountProvider } from "@/contexts/CountContext"
import { DialogProvider } from "@/contexts/DialogContext"
import { FocusProvider } from "@/contexts/FocusContext"
import { OptimisticUpdatesProvider } from "@/contexts/OptimisticUpdatesContext"

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string)

export function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <ConvexProvider client={convex}>
        <CountProvider>
          <OptimisticUpdatesProvider>
            <FocusProvider>
              <DialogProvider>
                <SidebarProvider defaultOpen>
                  <Layout />
                  <DialogManager />
                  <Toaster />
                </SidebarProvider>
              </DialogProvider>
            </FocusProvider>
          </OptimisticUpdatesProvider>
        </CountProvider>
      </ConvexProvider>
    </ThemeProvider>
  )
}