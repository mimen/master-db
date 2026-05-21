import { describe, expect, test } from "vitest"

import { mergeAgentOverlay, type AgentOverlay } from "./agentOverlay"

const task = (id: string) => ({ todoist_id: id, content: `T${id}` }) as { todoist_id: string; content: string }

describe("mergeAgentOverlay", () => {
  test("attaches _agent by entity_ref (todoist:task:<id>)", () => {
    const overlay: Record<string, AgentOverlay> = {
      "todoist:task:a": { hasRun: true, status: "awaiting_decision", last_urgency: 0.9, last_chatted_at: 500 },
    }
    const [a, b] = mergeAgentOverlay([task("a"), task("b")], overlay)
    expect(a._agent).toEqual(overlay["todoist:task:a"])
    expect(b._agent).toBeUndefined()
  })

  test("empty overlay leaves tasks unchanged", () => {
    const [a] = mergeAgentOverlay([task("a")], {})
    expect(a._agent).toBeUndefined()
  })
})
