import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import schema from "../../schema";

const modules = import.meta.glob("../../**/*.*s");

describe("agentic schema", () => {
  test("inserts and reads back an agenticRuns row", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) => {
      return ctx.db.insert("agenticRuns", {
        entity_ref: "todoist:task:abc",
        entity_type: "todoist_task",
        entity_id: "abc",
        backend: "claude_sdk",
        resume_cursor: null,
        status: "idle",
        last_message_id: null,
        last_run_id: null,
        last_traceparent: null,
        updated_at: Date.now(),
      });
    });
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.entity_ref).toBe("todoist:task:abc");
  });

  test("inserts an agenticThreadMessages row with checkpoint_id", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("agenticThreadMessages", {
        entity_ref: "todoist:task:abc",
        sequence: 1,
        run_id: "01HXKE5",
        kind: "proposal",
        body_markdown: null,
        proposal_json: { kind: "proposal", summary: "x", options: [], free_text_allowed: true },
        error_json: null,
        token_usage: null,
        checkpoint_id: "11111111-1111-1111-1111-111111111111",
      });
    });
  });

  test("inserts an agenticThreadActivities row", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("agenticThreadActivities", {
        entity_ref: "todoist:task:abc",
        sequence: 2,
        run_id: "01HXKE5",
        kind: "tool_call",
        name: "Read",
        input_json: { path: "/x" },
        output_json: null,
        status: "pending",
        resolved_at: null,
      });
    });
  });
});
