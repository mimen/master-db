// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

vi.mock("@/lib/agent/engineClient", () => ({
  postRun: vi.fn().mockResolvedValue({ run_id: "r1", status: "discovering", accepted: true }),
  postInterrupt: vi.fn().mockResolvedValue({ status: "idle" }),
}))
vi.mock("ulid", () => ({ ulid: () => "01HULID" }))

const { useAgentPost } = await import("./useAgentPost")
const { postRun, postInterrupt } = await import("@/lib/agent/engineClient")

describe("useAgentPost", () => {
  test("execute() sends EXECUTE: id with interrupt strategy", async () => {
    const { result } = renderHook(() => useAgentPost("todoist:task:1"))
    await act(async () => {
      await result.current.execute("opt-b")
    })
    expect(postRun).toHaveBeenCalledWith(expect.objectContaining({
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
    expect(postRun).toHaveBeenCalledWith(expect.objectContaining({
      message: "MODIFY: opt-b: use a comma instead",
    }))
  })

  test("interrupt() calls postInterrupt", async () => {
    const { result } = renderHook(() => useAgentPost("todoist:task:1"))
    await act(async () => {
      await result.current.interrupt()
    })
    expect(postInterrupt).toHaveBeenCalledWith("todoist:task:1")
  })

  test("each call gets a fresh idempotency_key (from ulid())", async () => {
    const { result } = renderHook(() => useAgentPost("todoist:task:1"))
    await act(async () => {
      await result.current.send("hello")
    })
    expect(postRun).toHaveBeenCalledWith(expect.objectContaining({
      idempotency_key: "01HULID",
    }))
  })
})
