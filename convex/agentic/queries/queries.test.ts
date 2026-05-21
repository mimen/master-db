import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "../../_generated/api";
import schema from "../../schema";
import { normalizeModules } from "../../test-utils.vitest";

const modules = normalizeModules(
  import.meta.glob("../../**/*.*s"),
  import.meta.url,
);

async function seed(
  t: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
  entity_ref: string,
) {
  await t.mutation(api.agentic.mutations.upsertRun.default, {
    entity_ref,
    entity_type: "todoist_task",
    entity_id: "x",
    backend: "claude_sdk",
    status: "awaiting_decision",
    run_id: "01H1",
    traceparent: null,
    resume_cursor: null,
  });
  await t.mutation(api.agentic.mutations.appendThreadMessage.default, {
    entity_ref,
    run_id: "01H1",
    kind: "user_message",
    body_markdown: "do the thing",
    proposal_json: null,
    error_json: null,
    token_usage: null,
    checkpoint_id: null,
  });
  await t.mutation(api.agentic.mutations.recordActivity.start, {
    entity_ref,
    run_id: "01H1",
    kind: "tool_call",
    name: "Read",
    input_json: {},
  });
  await t.mutation(api.agentic.mutations.appendThreadMessage.default, {
    entity_ref,
    run_id: "01H1",
    kind: "proposal",
    body_markdown: null,
    proposal_json: { kind: "proposal", summary: "ok", options: [], free_text_allowed: true },
    error_json: null,
    token_usage: null,
    checkpoint_id: "ck1",
  });
}

describe("agentic queries", () => {
  test("getRun returns the row or null", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: "milad@afternoonumbrellafriends.com" });
    await seed(t, "todoist:task:abc");
    const r = await t.query(api.agentic.queries.getRun.default, {
      entity_ref: "todoist:task:abc",
    });
    expect(r?.status).toBe("awaiting_decision");
    const missing = await t.query(api.agentic.queries.getRun.default, {
      entity_ref: "todoist:task:none",
    });
    expect(missing).toBeNull();
  });

  test("getThread returns messages and activities interleaved by sequence", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: "milad@afternoonumbrellafriends.com" });
    await seed(t, "todoist:task:abc");
    const thread = await t.query(api.agentic.queries.getThread.default, {
      entity_ref: "todoist:task:abc",
    });
    expect(thread.map((x: { sequence: number }) => x.sequence)).toEqual([1, 2, 3]);
    expect(thread.map((x: { row_type: string }) => x.row_type)).toEqual([
      "message",
      "activity",
      "message",
    ]);
  });

  test("getActivities filters by run_id", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: "milad@afternoonumbrellafriends.com" });
    await seed(t, "todoist:task:abc");
    const acts = await t.query(api.agentic.queries.getActivities.default, {
      run_id: "01H1",
    });
    expect(acts).toHaveLength(1);
    expect(acts[0].name).toBe("Read");
  });
});
