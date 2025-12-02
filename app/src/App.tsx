import { ConvexProvider, ConvexReactClient } from "convex/react"
import { ThemeProvider } from "next-themes"
import { Router } from "wouter"

import { DialogManager } from "@/components/dialogs/DialogManager"
import { Layout } from "@/components/layout/Layout"
import { SidebarProvider } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { CountProvider } from "@/contexts/CountContext"
import { DialogProvider } from "@/contexts/DialogContext"
import { FocusProvider } from "@/contexts/FocusContext"
import { HeaderSlotProvider } from "@/contexts/HeaderSlotContext"
import { OptimisticUpdatesProvider } from "@/contexts/OptimisticUpdatesContext"

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string)

export function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <ConvexProvider client={convex}>
        <Router>
          <CountProvider>
            <OptimisticUpdatesProvider>
              <FocusProvider>
                <DialogProvider>
                  <SidebarProvider defaultOpen>
                    <HeaderSlotProvider>
                      <Layout />
                    </HeaderSlotProvider>
                    <DialogManager />
                    <Toaster />
                  </SidebarProvider>
                </DialogProvider>
              </FocusProvider>
            </OptimisticUpdatesProvider>
          </CountProvider>
        </Router>
      </ConvexProvider>
    </ThemeProvider>
  )
}