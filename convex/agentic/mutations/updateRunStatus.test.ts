import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "../../_generated/api";
import schema from "../../schema";
import { normalizeModules } from "../../test-utils.vitest";

const modules = normalizeModules(
  import.meta.glob("../../**/*.*s"),
  import.meta.url,
);

describe("updateRunStatus", () => {
  test("patches status and last_message_id", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: "milad@afternoonumbrellafriends.com" });
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
    const msgId = await t.mutation(api.agentic.mutations.appendThreadMessage.default, {
      entity_ref: "todoist:task:abc",
      run_id: "01H1",
      kind: "proposal",
      body_markdown: null,
      proposal_json: { kind: "proposal", summary: "x", options: [], free_text_allowed: true },
      error_json: null,
      token_usage: null,
      checkpoint_id: "ck1",
    });
    await t.mutation(api.agentic.mutations.updateRunStatus.default, {
      entity_ref: "todoist:task:abc",
      status: "awaiting_decision",
      last_message_id: msgId,
      resume_cursor: { session_id: "s" },
    });
    const row = await t.run(async (ctx) =>
      ctx.db
        .query("agenticRuns")
        .withIndex("by_entity_ref", (q) => q.eq("entity_ref", "todoist:task:abc"))
        .unique()
    );
    expect(row?.status).toBe("awaiting_decision");
    expect(row?.last_message_id).toBe(msgId);
    expect(row?.resume_cursor).toEqual({ session_id: "s" });
  });

  test("throws if no run exists", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: "milad@afternoonumbrellafriends.com" });
    await expect(
      t.mutation(api.agentic.mutations.updateRunStatus.default, {
        entity_ref: "missing",
        status: "error",
        last_message_id: null,
        resume_cursor: null,
      }),
    ).rejects.toThrow();
  });
});
