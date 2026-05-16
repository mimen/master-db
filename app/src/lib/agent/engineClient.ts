export type PostRunInput = {
  entity_ref: string
  message: string | null
  idempotency_key: string
  multitask_strategy?: "enqueue" | "interrupt" | "reject"
  webhook?: string
  webhook_token?: string
}

export type PostRunResponse = {
  entity_ref: string
  run_id: string
  status: string
  accepted: boolean
}

function getEngineConfig() {
  const url = import.meta.env.VITE_AGENTIC_ENGINE_URL as string | undefined
  const token = import.meta.env.VITE_AGENTIC_ENGINE_TOKEN as string | undefined
  if (!url || !token) throw new Error("agentic engine config missing — set VITE_AGENTIC_ENGINE_URL and VITE_AGENTIC_ENGINE_TOKEN")
  return { url, token }
}

export async function postRun(input: PostRunInput): Promise<PostRunResponse> {
  const { url, token } = getEngineConfig()
  const { idempotency_key, ...body } = input
  const res = await fetch(`${url}/run`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotency_key,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`postRun failed: ${res.status}`)
  return res.json() as Promise<PostRunResponse>
}

export async function postInterrupt(entity_ref: string): Promise<{ status: string }> {
  const { url, token } = getEngineConfig()
  const res = await fetch(`${url}/run/${encodeURIComponent(entity_ref)}/interrupt`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`postInterrupt failed: ${res.status}`)
  return res.json() as Promise<{ status: string }>
}
