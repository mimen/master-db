import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { normalizeModules } from "../../test-utils.vitest";

const modules = normalizeModules(
  import.meta.glob("../../**/*.*s"),
  import.meta.url,
);

describe("recordActivity", () => {
  test("creates a pending activity and resolves it later", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: "milad@afternoonumbrellafriends.com" });
    const id = (await t.mutation(api.agentic.mutations.recordActivity.start, {
      entity_ref: "todoist:task:abc",
      run_id: "01H1",
      kind: "tool_call",
      name: "Read",
      input_json: { path: "/x" },
    })) as Id<"agenticThreadActivities">;
    const pending = await t.run(async (ctx) => ctx.db.get(id));
    expect(pending?.status).toBe("pending");
    expect(pending?.output_json).toBeNull();
    expect(pending?.sequence).toBe(1);

    await t.mutation(api.agentic.mutations.recordActivity.resolve, {
      id,
      status: "ok",
      output_json: { content: "hello" },
    });
    const resolved = await t.run(async (ctx) => ctx.db.get(id));
    expect(resolved?.status).toBe("ok");
    expect(resolved?.output_json).toEqual({ content: "hello" });
    expect(resolved?.resolved_at).toBeTypeOf("number");
  });

  test("activity sequences share space with messages per entity", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: "milad@afternoonumbrellafriends.com" });
    await t.mutation(api.agentic.mutations.appendThreadMessage.default, {
      entity_ref: "todoist:task:abc",
      run_id: "01H1",
      kind: "assistant_message",
      body_markdown: "x",
      proposal_json: null,
      error_json: null,
      token_usage: null,
      checkpoint_id: null,
    });
    await t.mutation(api.agentic.mutations.recordActivity.start, {
      entity_ref: "todoist:task:abc",
      run_id: "01H1",
      kind: "tool_call",
      name: "Read",
      input_json: {},
    });
    const acts = await t.run(async (ctx) =>
      ctx.db
        .query("agenticThreadActivities")
        .withIndex("by_entity_ref_and_sequence", (q) =>
          q.eq("entity_ref", "todoist:task:abc")
        )
        .collect()
    );
    expect(acts[0].sequence).toBe(2);
  });
});
