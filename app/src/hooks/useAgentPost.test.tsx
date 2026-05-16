// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

const postRunMock = vi.fn().mockResolvedValue({ run_id: "r1", status: "discovering", accepted: true })
const postInterruptMock = vi.fn().mockResolvedValue({ status: "idle" })

vi.mock("convex/react", () => ({
  useAction: (fn: unknown) => {
    const fnStr = String(fn ?? "")
    if (fnStr.includes("postRun")) return postRunMock
    if (fnStr.includes("postInterrupt")) return postInterruptMock
    return vi.fn()
  },
}))

vi.mock("@/convex/_generated/api", () => ({
  api: {
    agentic: {
      actions: {
        postRun: { default: "stub.agentic.actions.postRun" },
        postInterrupt: { default: "stub.agentic.actions.postInterrupt" },
      },
    },
  },
}))

vi.mock("ulid", () => ({ ulid: () => "01HULID" }))

const { useAgentPost } = await import("./useAgentPost")

describe("useAgentPost", () => {
  test("execute() sends EXECUTE: id with interrupt strategy", async () => {
    const { result } = renderHook(() => useAgentPost("todoist:task:1"))
    await act(async () => {
      await result.current.execute("opt-b")
    })
    expect(postRunMock).toHaveBeenCalledWith(expect.objectContaining({
      entity_ref: "todoist:task:1",
      message: "EXECUTE: opt-b",
      multitask_strategy: "interrupt",
    }))
  })

  test("modify() sends MODIFY: id: text", async () => {
    const { result } = renderHook(() => useAgentPost("todoist:task:1"))
    await act(async () => {
      await result.current.modify("opt-b", "use a comma instead")
    })
    expect(postRunMock).toHaveBeenCalledWith(expect.objectContaining({
      message: "MODIFY: opt-b: use a comma instead",
    }))
  })

  test("interrupt() calls postInterrupt", async () => {
    const { result } = renderHook(() => useAgentPost("todoist:task:1"))
    await act(async () => {
      await result.current.interrupt()
    })
    expect(postInterruptMock).toHaveBeenCalledWith({ entity_ref: "todoist:task:1" })
  })

  test("each call gets a fresh idempotency_key (from ulid())", async () => {
    const { result } = renderHook(() => useAgentPost("todoist:task:1"))
    await act(async () => {
      await result.current.send("hello")
    })
    expect(postRunMock).toHaveBeenCalledWith(expect.objectContaining({
      idempotency_key: "01HULID",
    }))
  })
})
