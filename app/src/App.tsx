import { ConvexProvider, ConvexReactClient } from "convex/react"

import { DialogManager } from "@/components/dialogs/DialogManager"
import { Layout } from "@/components/layout/Layout"
import { DialogProvider } from "@/contexts/OverlayContext"

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string)

export function App() {
  return (
    <ConvexProvider client={convex}>
      <DialogProvider>
        <Layout />
        <DialogManager />
      </DialogProvider>
    </ConvexProvider>
  )
}