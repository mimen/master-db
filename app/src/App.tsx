import { ConvexProvider, ConvexReactClient } from "convex/react"

import { Layout } from "@/components/layout/Layout"

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string)

export function App() {
  return (
    <ConvexProvider client={convex}>
      <Layout />
    </ConvexProvider>
  )
}