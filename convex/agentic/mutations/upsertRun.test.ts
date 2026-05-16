import * as path from "node:path";
import * as url from "node:url";

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "../../_generated/api";
import schema from "../../schema";

// import.meta.glob from a subdirectory of convex/ produces inconsistent keys:
// files in the same directory get "./filename" while others get "../../other/filename".
// convex-test's findModulesRoot uses the _generated key to find the prefix and then
// looks up "prefix + functionPath" — so keys must all use the same prefix.
// We normalize all keys to be relative to the convex/ root (prefixed with "../../").
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const rawModules = import.meta.glob("../../**/*.*s");
const convexRoot = path.resolve(__dirname, "../..");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([key, loader]) => {
    const abs = path.resolve(__dirname, key);
    const rel = "../../" + path.relative(convexRoot, abs).replace(/\\/g, "/");
    return [rel, loader];
  }),
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
