import { convexTest } from "convex-test"
import { describe, expect, test } from "vitest"

import { api } from "../../_generated/api"
import { ALLOWED_EMAIL } from "../../_lib/authed"
import schema from "../../schema"
import { normalizeModules } from "../../test-utils.vitest"

const modules = normalizeModules(import.meta.glob("../../**/*.*s"), import.meta.url)

async function seedRun(t: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>, args: {
  entity_id: string; status: string; last_urgency?: number | null; updated_at?: number
}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("agenticRuns", {
      entity_ref: `todoist:task:${args.entity_id}`, entity_type: "todoist_task", entity_id: args.entity_id,
      backend: "claude_sdk", resume_cursor: null, status: args.status, last_message_id: null,
      last_run_id: "01H", last_traceparent: null,
      ...(args.last_urgency !== undefined && { last_urgency: args.last_urgency }),
      updated_at: args.updated_at ?? 100,
    })
  })
}

describe("agentOverlayByEntityRefs", () => {
  test("returns a map keyed by entity_ref with hasRun + status + urgency + last_chatted_at", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL })
    await seedRun(t, { entity_id: "a", status: "awaiting_decision", last_urgency: 0.9, updated_at: 500 })
    const map = await t.query(api.agentic.queries.agentOverlayByEntityRefs.default, {
      entity_refs: ["todoist:task:a", "todoist:task:missing"],
    })
    expect(map["todoist:task:a"]).toEqual({ hasRun: true, status: "awaiting_decision", last_urgency: 0.9, last_chatted_at: 500 })
    expect(map["todoist:task:missing"]).toBeUndefined()
  })

  test("empty input returns empty map", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL })
    const map = await t.query(api.agentic.queries.agentOverlayByEntityRefs.default, { entity_refs: [] })
    expect(map).toEqual({})
  })
})
