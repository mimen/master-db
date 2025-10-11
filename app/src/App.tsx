import { ConvexProvider, ConvexReactClient } from "convex/react"

import { DialogManager } from "@/components/dialogs/DialogManager"
import { Layout } from "@/components/layout/Layout"
import { Toaster } from "@/components/ui/sonner"
import { DialogProvider } from "@/contexts/DialogContext"

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string)

export function App() {
  return (
    <ConvexProvider client={convex}>
      <DialogProvider>
        <Layout />
        <DialogManager />
        <Toaster />
      </DialogProvider>
    </ConvexProvider>
  )
}