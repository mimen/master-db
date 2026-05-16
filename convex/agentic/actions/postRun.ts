import { v } from "convex/values"

import { action } from "../../_generated/server"

export type PostRunResponse = {
  entity_ref: string
  run_id: string
  status: string
  accepted: boolean
}

export default action({
  args: {
    entity_ref: v.string(),
    message: v.union(v.string(), v.null()),
    idempotency_key: v.string(),
    multitask_strategy: v.optional(v.string()),
    webhook: v.optional(v.string()),
    webhook_token: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<PostRunResponse> => {
    const url = process.env.AGENTIC_ENGINE_URL
    const token = process.env.AGENTIC_ENGINE_TOKEN
    if (!url || !token) {
      throw new Error(
        "Convex env missing: set AGENTIC_ENGINE_URL and AGENTIC_ENGINE_TOKEN via `bunx convex env set`",
      )
    }
    const { idempotency_key, ...body } = args
    const res = await fetch(`${url}/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotency_key,
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`engine /run returned ${res.status}`)
    return res.json() as Promise<PostRunResponse>
  },
})
