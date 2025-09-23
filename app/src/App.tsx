import { ConvexProvider, ConvexReactClient } from "convex/react"
import { InboxView } from "@/components/InboxView"

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string)

export function App() {
  return (
    <ConvexProvider client={convex}>
      <div className="min-h-screen bg-background">
        <InboxView />
      </div>
    </ConvexProvider>
  )
}