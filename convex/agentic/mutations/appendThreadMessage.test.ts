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
    const t = convexTest(schema, modules).withIdentity({ email: "milad@afternoonumbrellafriends.com" });
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

  test("denormalizes last_urgency onto agenticRuns when proposal lands", async () => {
    const t = convexTest(schema, modules).withIdentity({
      email: "milad@afternoonumbrellafriends.com",
    });
    await t.mutation(api.agentic.mutations.upsertRun.default, {
      entity_ref: "todoist:task:urgent",
      entity_type: "todoist_task",
      entity_id: "urgent",
      backend: "claude_sdk",
      status: "discovering",
      run_id: "01H1",
      traceparent: null,
      resume_cursor: null,
    });
    await t.mutation(api.agentic.mutations.appendThreadMessage.default, {
      entity_ref: "todoist:task:urgent",
      run_id: "01H1",
      kind: "proposal",
      body_markdown: null,
      proposal_json: {
        kind: "proposal",
        summary: "x",
        options: [],
        free_text_allowed: true,
        urgency: 0.9,
        urgency_reasoning: "due tomorrow",
      },
      error_json: null,
      token_usage: null,
      checkpoint_id: "ck1",
    });
    const row = await t.run(async (ctx) =>
      ctx.db
        .query("agenticRuns")
        .withIndex("by_entity_ref", (q) =>
          q.eq("entity_ref", "todoist:task:urgent"),
        )
        .unique(),
    );
    expect(row?.last_urgency).toBe(0.9);
  });

  test("denormalizes last_urgency to null when proposal omits urgency", async () => {
    const t = convexTest(schema, modules).withIdentity({
      email: "milad@afternoonumbrellafriends.com",
    });
    await t.mutation(api.agentic.mutations.upsertRun.default, {
      entity_ref: "todoist:task:notagged",
      entity_type: "todoist_task",
      entity_id: "notagged",
      backend: "claude_sdk",
      status: "discovering",
      run_id: "01H1",
      traceparent: null,
      resume_cursor: null,
    });
    await t.mutation(api.agentic.mutations.appendThreadMessage.default, {
      entity_ref: "todoist:task:notagged",
      run_id: "01H1",
      kind: "proposal",
      body_markdown: null,
      proposal_json: {
        kind: "proposal",
        summary: "x",
        options: [],
        free_text_allowed: true,
      },
      error_json: null,
      token_usage: null,
      checkpoint_id: "ck1",
    });
    const row = await t.run(async (ctx) =>
      ctx.db
        .query("agenticRuns")
        .withIndex("by_entity_ref", (q) =>
          q.eq("entity_ref", "todoist:task:notagged"),
        )
        .unique(),
    );
    expect(row?.last_urgency).toBeNull();
  });

  test("does not touch last_urgency for non-proposal messages", async () => {
    const t = convexTest(schema, modules).withIdentity({
      email: "milad@afternoonumbrellafriends.com",
    });
    await t.mutation(api.agentic.mutations.upsertRun.default, {
      entity_ref: "todoist:task:nochange",
      entity_type: "todoist_task",
      entity_id: "nochange",
      backend: "claude_sdk",
      status: "discovering",
      run_id: "01H1",
      traceparent: null,
      resume_cursor: null,
    });
    // Seed urgency from a previous proposal.
    await t.mutation(api.agentic.mutations.appendThreadMessage.default, {
      entity_ref: "todoist:task:nochange",
      run_id: "01H1",
      kind: "proposal",
      body_markdown: null,
      proposal_json: {
        kind: "proposal",
        summary: "x",
        options: [],
        free_text_allowed: true,
        urgency: 0.7,
      },
      error_json: null,
      token_usage: null,
      checkpoint_id: "ck1",
    });
    // Subsequent non-proposal message must not overwrite.
    await t.mutation(api.agentic.mutations.appendThreadMessage.default, {
      entity_ref: "todoist:task:nochange",
      run_id: "01H1",
      kind: "assistant_message",
      body_markdown: "follow-up",
      proposal_json: null,
      error_json: null,
      token_usage: null,
      checkpoint_id: null,
    });
    const row = await t.run(async (ctx) =>
      ctx.db
        .query("agenticRuns")
        .withIndex("by_entity_ref", (q) =>
          q.eq("entity_ref", "todoist:task:nochange"),
        )
        .unique(),
    );
    expect(row?.last_urgency).toBe(0.7);
  });

  test("separate entities have independent sequences", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: "milad@afternoonumbrellafriends.com" });
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
