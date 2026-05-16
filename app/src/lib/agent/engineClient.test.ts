import { beforeEach, describe, expect, test, vi } from "vitest"

import { postInterrupt, postRun } from "./engineClient"

const ENGINE = "http://localhost:8787"
const TOKEN = "test-tok"

beforeEach(() => {
  vi.stubEnv("VITE_AGENTIC_ENGINE_URL", ENGINE)
  vi.stubEnv("VITE_AGENTIC_ENGINE_TOKEN", TOKEN)
})

describe("postRun", () => {
  test("POSTs JSON body with bearer + idempotency-key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ run_id: "r1", status: "discovering", accepted: true }) })
    vi.stubGlobal("fetch", fetchMock)
    const res = await postRun({ entity_ref: "todoist:task:1", message: null, idempotency_key: "k1" })
    expect(fetchMock).toHaveBeenCalledWith(`${ENGINE}/run`, expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        "Authorization": `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        "Idempotency-Key": "k1",
      }),
    }))
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body).toEqual({ entity_ref: "todoist:task:1", message: null })
    expect(res).toEqual({ run_id: "r1", status: "discovering", accepted: true })
  })

  test("sends multitask_strategy when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal("fetch", fetchMock)
    await postRun({ entity_ref: "x", message: "EXECUTE: a", idempotency_key: "k", multitask_strategy: "interrupt" })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.multitask_strategy).toBe("interrupt")
  })

  test("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({}) }))
    await expect(postRun({ entity_ref: "x", message: null, idempotency_key: "k" })).rejects.toThrow(/409/)
  })
})

describe("postInterrupt", () => {
  test("POSTs to /run/:ref/interrupt", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "idle" }) })
    vi.stubGlobal("fetch", fetchMock)
    await postInterrupt("todoist:task:1")
    expect(fetchMock).toHaveBeenCalledWith(
      `${ENGINE}/run/${encodeURIComponent("todoist:task:1")}/interrupt`,
      expect.objectContaining({ method: "POST" }),
    )
  })
})
