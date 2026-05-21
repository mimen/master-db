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
    description?: string
    priority?: number
    due?: string
    deadline?: string
    labels?: Array<{ name: string; color: string }>
    project?: { todoist_id: string; name: string; color: string }
    checked?: boolean
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
    if (args.labels) {
      for (const label of args.labels) {
        await ctx.db.insert("todoist_labels", {
          todoist_id: `lbl-${label.name}`,
          name: label.name,
          color: label.color,
          order: 0,
          is_deleted: false,
          is_favorite: false,
          sync_version: 1,
        })
      }
    }
    await ctx.db.insert("todoist_items", {
      todoist_id: args.entity_id,
      content: args.task_content ?? `Task ${args.entity_id}`,
      ...(args.description !== undefined && { description: args.description }),
      child_order: 0,
      priority: args.priority ?? 1,
      ...(args.due !== undefined && { due: { date: args.due } }),
      ...(args.deadline !== undefined && { deadline: { date: args.deadline, lang: "en" } }),
      ...(args.project && { project_id: args.project.todoist_id }),
      labels: args.labels ? args.labels.map((l) => l.name) : [],
      comment_count: 0,
      checked: args.checked ?? false,
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
    expect(rows[0]?.deadline).toBeNull()
    expect(rows[0]?.labels).toEqual([])
    expect(rows[0]?.description).toBeNull()
  })

  test("enriches rows with the task description", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL })
    await seedRun(t, {
      entity_id: "a",
      status: "awaiting_decision",
      description: "Long-form notes about this task",
    })

    const rows = await t.query(api.agentic.queries.listAwaitingDecision.default, {})
    expect(rows[0]?.description).toBe("Long-form notes about this task")
  })

  test("enriches rows with deadline and resolved labels", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL })
    await seedRun(t, {
      entity_id: "a",
      status: "awaiting_decision",
      deadline: "2026-06-15",
      labels: [
        { name: "urgent", color: "red" },
        { name: "waiting", color: "blue" },
      ],
    })

    const rows = await t.query(api.agentic.queries.listAwaitingDecision.default, {})
    expect(rows[0]?.deadline).toBe("2026-06-15")
    expect(rows[0]?.labels).toEqual([
      { name: "urgent", color: "red" },
      { name: "waiting", color: "blue" },
    ])
  })

  test("unknown label name falls back to charcoal color", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL })
    await t.run(async (ctx) => {
      await ctx.db.insert("agenticRuns", {
        entity_ref: "todoist:task:z",
        entity_type: "todoist_task",
        entity_id: "z",
        backend: "claude_sdk",
        resume_cursor: null,
        status: "awaiting_decision",
        last_message_id: null,
        last_run_id: "01H",
        last_traceparent: null,
        updated_at: Date.now(),
      })
      await ctx.db.insert("todoist_items", {
        todoist_id: "z",
        content: "Task z",
        child_order: 0,
        priority: 1,
        labels: ["ghost"],
        comment_count: 0,
        checked: false,
        is_deleted: false,
        added_at: "2026-01-01T00:00:00Z",
        user_id: "u1",
        sync_version: 1,
      })
    })

    const rows = await t.query(api.agentic.queries.listAwaitingDecision.default, {})
    expect(rows[0]?.labels).toEqual([{ name: "ghost", color: "charcoal" }])
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

  test("excludes completed (checked) tasks from open results", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL })
    await seedRun(t, { entity_id: "open", status: "awaiting_decision", checked: false })
    await seedRun(t, { entity_id: "done", status: "awaiting_decision", checked: true })

    const rows = await t.query(api.agentic.queries.listAwaitingDecision.default, {})
    expect(rows.map((r: { entity_id: string }) => r.entity_id)).toEqual(["open"])
  })

  test("closed mode returns only completed tasks (across open statuses)", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL })
    await seedRun(t, { entity_id: "open", status: "awaiting_decision", checked: false })
    await seedRun(t, { entity_id: "done", status: "awaiting_decision", checked: true })
    await seedRun(t, { entity_id: "done2", status: "executing", checked: true })
    await seedRun(t, { entity_id: "idle-done", status: "idle", checked: true })

    const rows = await t.query(api.agentic.queries.listAwaitingDecision.default, {
      closed: true,
    })
    expect(rows.map((r: { entity_id: string }) => r.entity_id).sort()).toEqual([
      "done",
      "done2",
    ])
  })

  test("returned rows carry the checked flag", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL })
    await seedRun(t, { entity_id: "a", status: "awaiting_decision", checked: false })

    const rows = await t.query(api.agentic.queries.listAwaitingDecision.default, {})
    expect(rows[0]?.checked).toBe(false)
  })
})
