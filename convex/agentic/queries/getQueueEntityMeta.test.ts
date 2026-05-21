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

async function seed(
  t: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("agenticRuns", {
      entity_ref: "todoist:task:a",
      entity_type: "todoist_task",
      entity_id: "a",
      backend: "claude_sdk",
      resume_cursor: null,
      status: "awaiting_decision",
      last_message_id: null,
      last_run_id: "01H",
      last_traceparent: null,
      updated_at: 100,
    })
    await ctx.db.insert("todoist_projects", {
      todoist_id: "p1",
      name: "AUF",
      color: "lavender",
      child_order: 0,
      is_deleted: false,
      is_archived: false,
      is_favorite: false,
      view_style: "list",
      sync_version: 1,
    })
    await ctx.db.insert("todoist_items", {
      todoist_id: "a",
      content: "Email Sarah",
      project_id: "p1",
      child_order: 0,
      priority: 4,
      due: { date: "2026-06-01" },
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

describe("getQueueEntityMeta", () => {
  test("returns the enriched object for a known entity_ref", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL })
    await seed(t)

    const meta = await t.query(api.agentic.queries.getQueueEntityMeta.default, {
      entity_ref: "todoist:task:a",
    })
    expect(meta?.entity_title).toBe("Email Sarah")
    expect(meta?.priority).toBe(4)
    expect(meta?.due).toBe("2026-06-01")
    expect(meta?.project).toEqual({ name: "AUF", color: "lavender" })
  })

  test("returns null for an unknown entity_ref", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL })
    await seed(t)

    const meta = await t.query(api.agentic.queries.getQueueEntityMeta.default, {
      entity_ref: "todoist:task:nope",
    })
    expect(meta).toBeNull()
  })
})
