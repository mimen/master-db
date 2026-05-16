// @vitest-environment jsdom
import { describe, expect, test } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { AgentDrawerProvider, useAgentDrawer } from "./AgentDrawerContext"

describe("AgentDrawerContext", () => {
  test("opens with an entity_ref and closes", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AgentDrawerProvider>{children}</AgentDrawerProvider>
    )
    const { result } = renderHook(() => useAgentDrawer(), { wrapper })
    expect(result.current.activeEntityRef).toBeNull()
    expect(result.current.isOpen).toBe(false)

    act(() => result.current.open("todoist:task:1"))
    expect(result.current.isOpen).toBe(true)
    expect(result.current.activeEntityRef).toBe("todoist:task:1")

    act(() => result.current.close())
    expect(result.current.isOpen).toBe(false)
    expect(result.current.activeEntityRef).toBeNull()
  })
})
