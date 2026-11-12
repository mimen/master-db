import { ConvexAuthProvider } from "@convex-dev/auth/react"
import { ConvexReactClient } from "convex/react"
import { ThemeProvider } from "next-themes"
import { Route, Router, Switch } from "wouter"

import { AuthGate } from "@/auth/AuthGate"
import { AgentDrawer } from "@/components/agent/AgentDrawer"
import { DialogManager } from "@/components/dialogs/DialogManager"
import { Layout } from "@/components/layout/Layout"
import { SavedInboxView } from "@/components/SavedInboxView"
import { SidebarProvider } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { AgentDrawerProvider, useAgentDrawer } from "@/contexts/AgentDrawerContext"
import { CountProvider } from "@/contexts/CountContext"
import { DialogProvider } from "@/contexts/DialogContext"
import { HeaderSlotProvider } from "@/contexts/HeaderSlotContext"
import { OptimisticUpdatesProvider } from "@/contexts/OptimisticUpdatesContext"
import { useAgentKeybindings } from "@/hooks/useAgentKeybindings"

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string)

/**
 * Mounts the g-a keyboard chord for opening the agent drawer.
 * useTaskSelection is a parameterized generic hook — there is no global
 * singleton exposing the currently-focused task. The trigger button on
 * TaskListItem is the primary entry point until task-selection is plumbed
 * into a global store.
 * TODO (Task 7+): wire openForActiveTask to a global focused-task store.
 */
function AgentKeybindingsHost() {
  const { open } = useAgentDrawer()
  useAgentKeybindings({
    enabled: true,
    openForActiveTask: () => {
      // TODO: derive entity_ref from a global selection store when available.
      // useTaskSelection is parameterized per-list, not a global singleton.
      void open
    },
  })
  return null
}

export function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <ConvexAuthProvider client={convex}>
        <AuthGate>
          <Router>
            <CountProvider>
              <OptimisticUpdatesProvider>
                <AgentDrawerProvider>
                  <AgentKeybindingsHost />
                  <DialogProvider>
                    <SidebarProvider defaultOpen>
                      <Switch>
                        <Route path="/saved" component={SavedInboxView} />
                        <Route>
                          <HeaderSlotProvider>
                            <Layout />
                          </HeaderSlotProvider>
                        </Route>
                      </Switch>
                      <DialogManager />
                      <AgentDrawer />
                      <Toaster />
                    </SidebarProvider>
                  </DialogProvider>
                </AgentDrawerProvider>
              </OptimisticUpdatesProvider>
            </CountProvider>
          </Router>
        </AuthGate>
      </ConvexAuthProvider>
    </ThemeProvider>
  )
}