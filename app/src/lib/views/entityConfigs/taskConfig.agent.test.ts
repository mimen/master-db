import { describe, expect, test } from "vitest"

import type { AgentOverlay, WithAgent } from "@/lib/agent/agentOverlay"
import type { TodoistTaskWithProject } from "@/types/convex/todoist"

import { agentSortOptions } from "./taskConfig"

const overlay = (last_urgency: number | null, last_chatted_at: number): AgentOverlay => ({
  hasRun: true,
  status: "awaiting_decision",
  last_urgency,
  last_chatted_at,
})

// Minimal WithAgent task; only the agent overlay and an id matter to the comparators.
const task = (id: string, agent?: AgentOverlay): WithAgent<TodoistTaskWithProject> =>
  ({ todoist_id: id, content: id, ...(agent ? { _agent: agent } : {}) }) as WithAgent<TodoistTaskWithProject>

const urgencyCompare = agentSortOptions.find((o) => o.id === "urgency")!.compareFn
const lastChattedCompare = agentSortOptions.find((o) => o.id === "last-chatted")!.compareFn

const sortBy = (
  tasks: WithAgent<TodoistTaskWithProject>[],
  compareFn: (a: TodoistTaskWithProject, b: TodoistTaskWithProject) => number,
) => [...tasks].sort(compareFn).map((t) => t.todoist_id)

describe("agentSortOptions", () => {
  test("urgency: numbers desc, no-run/null last", () => {
    const high = task("high", overlay(0.9, 100))
    const mid = task("mid", overlay(0.5, 100))
    const nullUrg = task("null", overlay(null, 999))
    const noRun = task("norun") // no _agent at all

    expect(sortBy([noRun, nullUrg, mid, high], urgencyCompare)).toEqual([
      "high",
      "mid",
      "null",
      "norun",
    ])
  })

  test("urgency: ties broken by last_chatted_at desc", () => {
    const older = task("older", overlay(0.7, 100))
    const newer = task("newer", overlay(0.7, 500))

    expect(sortBy([older, newer], urgencyCompare)).toEqual(["newer", "older"])
  })

  test("urgency: both null compared by last_chatted_at desc", () => {
    const a = task("a", overlay(null, 100))
    const b = task("b", overlay(null, 500))
    const noRun = task("norun") // last_chatted_at defaults to 0

    expect(sortBy([a, noRun, b], urgencyCompare)).toEqual(["b", "a", "norun"])
  })

  test("last-chatted: orders by timestamp desc, missing last", () => {
    const a = task("a", overlay(0.1, 100))
    const b = task("b", overlay(0.9, 500))
    const noRun = task("norun") // 0

    expect(sortBy([noRun, a, b], lastChattedCompare)).toEqual(["b", "a", "norun"])
  })
})
