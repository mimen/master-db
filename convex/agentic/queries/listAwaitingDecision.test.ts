import { convexTest } from "convex-test"
import { describe, expect, test } from "vitest"

import { api } from "../../_generated/api"
import { ALLOWED_EMAIL } from "../../_lib/authed"
import schema from "../../schema"
import { normalizeModules } from "../../test-utils.vitest"

const modules = normalizeModules(
  import.meta.glob("../../**/*.*s"),
  import.meta.url,
)

// Helper: seed a run + task pair.
async function seedRun(
  t: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
  args: {
    entity_id: string
    status: string
    last_urgency?: number | null
    updated_at?: number
    task_content?: string
    priority?: number
    due?: string
    project?: { todoist_id: string; name: string; color: string }
  },
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("agenticRuns", {
      entity_ref: `todoist:task:${args.entity_id}`,
      entity_type: "todoist_task",
      entity_id: args.entity_id,
      backend: "claude_sdk",
      resume_cursor: null,
      status: args.status,
      last_message_id: null,
      last_run_id: "01H",
      last_traceparent: null,
      ...(args.last_urgency !== undefined && { last_urgency: args.last_urgency }),
      updated_at: args.updated_at ?? Date.now(),
    })
    if (args.project) {
      await ctx.db.insert("todoist_projects", {
        todoist_id: args.project.todoist_id,
        name: args.project.name,
        color: args.project.color,
        child_order: 0,
        is_deleted: false,
        is_archived: false,
        is_favorite: false,
        view_style: "list",
        sync_version: 1,
      })
    }
    await ctx.db.insert("todoist_items", {
      todoist_id: args.entity_id,
      content: args.task_content ?? `Task ${args.entity_id}`,
      child_order: 0,
      priority: args.priority ?? 1,
      ...(args.due !== undefined && { due: { date: args.due } }),
      ...(args.project && { project_id: args.project.todoist_id }),
      labels: [],
      comment_count: 0,
      checked: false,
      is_deleted: false,
      added_at: "2026-01-01T00:00:00Z",
      user_id: "u1",
      sync_version: 1,
    })
  })
}

describe("listAwaitingDecision", () => {
  test("returns only the requested statuses (default awaiting_decision)", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL })
    await seedRun(t, { entity_id: "a", status: "awaiting_decision" })
    await seedRun(t, { entity_id: "b", status: "idle" })
    await seedRun(t, { entity_id: "c", status: "discovering" })

    const rows = await t.query(api.agentic.queries.listAwaitingDecision.default, {})
    expect(rows.map((r: { entity_id: string }) => r.entity_id).sort()).toEqual(["a"])
  })

  test("explicit statuses union", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL })
    await seedRun(t, { entity_id: "a", status: "awaiting_decision" })
    await seedRun(t, { entity_id: "b", status: "error" })
    await seedRun(t, { entity_id: "c", status: "idle" })

    const rows = await t.query(api.agentic.queries.listAwaitingDecision.default, {
      statuses: ["awaiting_decision", "error"],
    })
    expect(rows.map((r: { entity_id: string }) => r.entity_id).sort()).toEqual(["a", "b"])
  })

  test("urgency sort: higher urgency first, nulls last, ties on updated_at desc", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL })
    await seedRun(t, { entity_id: "a", status: "awaiting_decision", last_urgency: 0.5, updated_at: 100 })
    await seedRun(t, { entity_id: "b", status: "awaiting_decision", last_urgency: 0.9, updated_at: 50 })
    await seedRun(t, { entity_id: "c", status: "awaiting_decision", last_urgency: null, updated_at: 200 })
    await seedRun(t, { entity_id: "d", status: "awaiting_decision", last_urgency: 0.9, updated_at: 75 })

    const rows = await t.query(api.agentic.queries.listAwaitingDecision.default, {
      sort: "urgency",
    })
    expect(rows.map((r: { entity_id: string }) => r.entity_id)).toEqual(["d", "b", "a", "c"])
  })

  test("recent sort: updated_at desc regardless of urgency", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL })
    await seedRun(t, { entity_id: "a", status: "awaiting_decision", last_urgency: 0.99, updated_at: 100 })
    await seedRun(t, { entity_id: "b", status: "awaiting_decision", last_urgency: null, updated_at: 200 })

    const rows = await t.query(api.agentic.queries.listAwaitingDecision.default, {
      sort: "recent",
    })
    expect(rows.map((r: { entity_id: string }) => r.entity_id)).toEqual(["b", "a"])
  })

  test("joins task content from todoist_items", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL })
    await seedRun(t, { entity_id: "a", status: "awaiting_decision", task_content: "Email Sarah re: venue" })

    const rows = await t.query(api.agentic.queries.listAwaitingDecision.default, {})
    expect(rows[0]?.entity_title).toBe("Email Sarah re: venue")
  })

  test("enriches rows with priority, due, and project (raw color)", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL })
    await seedRun(t, {
      entity_id: "a",
      status: "awaiting_decision",
      task_content: "Email Sarah",
      priority: 4,
      due: "2026-06-01",
      project: { todoist_id: "p1", name: "AUF", color: "lavender" },
    })

    const rows = await t.query(api.agentic.queries.listAwaitingDecision.default, {})
    expect(rows[0]?.priority).toBe(4)
    expect(rows[0]?.due).toBe("2026-06-01")
    expect(rows[0]?.project).toEqual({ name: "AUF", color: "lavender" })
  })

  test("null priority/due/project when task has no metadata", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL })
    await seedRun(t, { entity_id: "a", status: "awaiting_decision" })

    const rows = await t.query(api.agentic.queries.listAwaitingDecision.default, {})
    expect(rows[0]?.due).toBeNull()
    expect(rows[0]?.project).toBeNull()
  })

  test("limit clamps at 500", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL })
    for (let i = 0; i < 10; i++) {
      await seedRun(t, { entity_id: `i${i}`, status: "awaiting_decision", updated_at: i })
    }
    const rows = await t.query(api.agentic.queries.listAwaitingDecision.default, {
      limit: 5,
    })
    expect(rows).toHaveLength(5)
  })
})
