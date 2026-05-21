import { describe, expect, test } from "vitest"

import {
  filterByAgent,
  mergeAgentOverlay,
  type AgentOverlay,
  type WithAgent,
} from "./agentOverlay"

const task = (id: string) => ({ todoist_id: id, content: `T${id}` }) as { todoist_id: string; content: string }

const overlay = (status: string): AgentOverlay => ({
  hasRun: true,
  status,
  last_urgency: null,
  last_chatted_at: 0,
})

type T = { todoist_id: string; content: string }
const withAgent = (id: string, status?: string): WithAgent<T> =>
  status === undefined ? task(id) : { ...task(id), _agent: overlay(status) }

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

describe("filterByAgent", () => {
  const tasks: WithAgent<T>[] = [
    withAgent("open-await", "awaiting_decision"),
    withAgent("open-disc", "discovering"),
    withAgent("open-exec", "executing"),
    withAgent("open-err", "error"),
    withAgent("closed-idle", "idle"),
    withAgent("no-run"), // no _agent
  ]

  test("all-open keeps open-status runs, drops closed + no-run", () => {
    const ids = filterByAgent(tasks, "all-open").map((t) => t.todoist_id)
    expect(ids).toEqual(["open-await", "open-disc", "open-exec", "open-err"])
  })

  test("closed keeps runs with a non-open status, drops open + no-run", () => {
    const ids = filterByAgent(tasks, "closed").map((t) => t.todoist_id)
    expect(ids).toEqual(["closed-idle"])
  })

  test("no-run keeps only tasks without an _agent overlay", () => {
    const ids = filterByAgent(tasks, "no-run").map((t) => t.todoist_id)
    expect(ids).toEqual(["no-run"])
  })

  test("a single status keeps only runs with that status", () => {
    expect(filterByAgent(tasks, "awaiting_decision").map((t) => t.todoist_id)).toEqual([
      "open-await",
    ])
    expect(filterByAgent(tasks, "discovering").map((t) => t.todoist_id)).toEqual(["open-disc"])
    expect(filterByAgent(tasks, "executing").map((t) => t.todoist_id)).toEqual(["open-exec"])
    expect(filterByAgent(tasks, "error").map((t) => t.todoist_id)).toEqual(["open-err"])
  })
})
