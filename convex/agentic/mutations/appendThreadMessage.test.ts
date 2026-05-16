import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "../../_generated/api";
import schema from "../../schema";
import { normalizeModules } from "../../test-utils.vitest";

const modules = normalizeModules(
  import.meta.glob("../../**/*.*s"),
  import.meta.url,
);

describe("appendThreadMessage", () => {
  test("assigns monotonic sequence per entity", async () => {
    const t = convexTest(schema, modules);
    const id1 = await t.mutation(api.agentic.mutations.appendThreadMessage.default, {
      entity_ref: "todoist:task:abc",
      run_id: "01H1",
      kind: "user_message",
      body_markdown: "hi",
      proposal_json: null,
      error_json: null,
      token_usage: null,
      checkpoint_id: null,
    });
    const id2 = await t.mutation(api.agentic.mutations.appendThreadMessage.default, {
      entity_ref: "todoist:task:abc",
      run_id: "01H1",
      kind: "assistant_message",
      body_markdown: "hello back",
      proposal_json: null,
      error_json: null,
      token_usage: null,
      checkpoint_id: null,
    });
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("agenticThreadMessages")
        .withIndex("by_entity_ref_and_sequence", (q) =>
          q.eq("entity_ref", "todoist:task:abc")
        )
        .collect()
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]._id).toBe(id1);
    expect(rows[0].sequence).toBe(1);
    expect(rows[1]._id).toBe(id2);
    expect(rows[1].sequence).toBe(2);
  });

  test("separate entities have independent sequences", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.agentic.mutations.appendThreadMessage.default, {
      entity_ref: "todoist:task:abc",
      run_id: "01H1",
      kind: "user_message",
      body_markdown: "x",
      proposal_json: null,
      error_json: null,
      token_usage: null,
      checkpoint_id: null,
    });
    await t.mutation(api.agentic.mutations.appendThreadMessage.default, {
      entity_ref: "todoist:task:xyz",
      run_id: "01H2",
      kind: "user_message",
      body_markdown: "y",
      proposal_json: null,
      error_json: null,
      token_usage: null,
      checkpoint_id: null,
    });
    const abc = await t.run(async (ctx) =>
      ctx.db
        .query("agenticThreadMessages")
        .withIndex("by_entity_ref_and_sequence", (q) =>
          q.eq("entity_ref", "todoist:task:abc")
        )
        .collect()
    );
    const xyz = await t.run(async (ctx) =>
      ctx.db
        .query("agenticThreadMessages")
        .withIndex("by_entity_ref_and_sequence", (q) =>
          q.eq("entity_ref", "todoist:task:xyz")
        )
        .collect()
    );
    expect(abc[0].sequence).toBe(1);
    expect(xyz[0].sequence).toBe(1);
  });
});
