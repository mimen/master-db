// @vitest-environment jsdom
import { renderHook } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

vi.mock("convex/react", () => ({
  useQuery: vi.fn().mockReturnValue(undefined),
}))
vi.mock("@/convex/_generated/api", () => ({ api: { agentic: { queries: {
  getThread: { default: "stub" }, getRun: { default: "stub" },
} } } }))
vi.mock("@assistant-ui/react", () => ({
  useExternalStoreRuntime: vi.fn().mockReturnValue({ _kind: "runtime" }),
}))

const { useAgentRuntime } = await import("./useAgentRuntime")

describe("useAgentRuntime", () => {
  test("returns isLoading=true when queries undefined", () => {
    const { result } = renderHook(() => useAgentRuntime("todoist:task:1"))
    expect(result.current.isLoading).toBe(true)
  })

  test("returns a runtime object", () => {
    const { result } = renderHook(() => useAgentRuntime("todoist:task:1"))
    expect(result.current.runtime).toEqual({ _kind: "runtime" })
  })
})
