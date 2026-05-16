import { v } from "convex/values"

import { action } from "../../_generated/server"

export default action({
  args: { entity_ref: v.string() },
  handler: async (_ctx, { entity_ref }): Promise<{ status: string }> => {
    const url = process.env.AGENTIC_ENGINE_URL
    const token = process.env.AGENTIC_ENGINE_TOKEN
    if (!url || !token) {
      throw new Error(
        "Convex env missing: set AGENTIC_ENGINE_URL and AGENTIC_ENGINE_TOKEN via `bunx convex env set`",
      )
    }
    const res = await fetch(`${url}/run/${encodeURIComponent(entity_ref)}/interrupt`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`engine /interrupt returned ${res.status}`)
    return res.json() as Promise<{ status: string }>
  },
})
