import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "../../_generated/api";
import schema from "../../schema";
import { normalizeModules } from "../../test-utils";

const modules = normalizeModules(
  import.meta.glob("../../**/*.*s"),
  import.meta.url,
);

describe("upsertRun", () => {
  test("creates a new row when none exists", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(api.agentic.mutations.upsertRun.default, {
      entity_ref: "todoist:task:abc",
      entity_type: "todoist_task",
      entity_id: "abc",
      backend: "claude_sdk",
      status: "discovering",
      run_id: "01H1",
      traceparent: null,
      resume_cursor: null,
    });
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.entity_ref).toBe("todoist:task:abc");
    expect(row?.status).toBe("discovering");
    expect(row?.last_run_id).toBe("01H1");
  });

  test("updates the existing row when one exists", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.agentic.mutations.upsertRun.default, {
      entity_ref: "todoist:task:abc",
      entity_type: "todoist_task",
      entity_id: "abc",
      backend: "claude_sdk",
      status: "discovering",
      run_id: "01H1",
      traceparent: null,
      resume_cursor: null,
    });
    await t.mutation(api.agentic.mutations.upsertRun.default, {
      entity_ref: "todoist:task:abc",
      entity_type: "todoist_task",
      entity_id: "abc",
      backend: "claude_sdk",
      status: "awaiting_decision",
      run_id: "01H2",
      traceparent: "00-trace-span-01",
      resume_cursor: { session_id: "abc" },
    });
    const all = await t.run(async (ctx) =>
      ctx.db.query("agenticRuns").collect()
    );
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("awaiting_decision");
    expect(all[0].last_run_id).toBe("01H2");
    expect(all[0].last_traceparent).toBe("00-trace-span-01");
  });
});
