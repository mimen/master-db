import { describe, expect, test, vi } from "vitest";

import { createConvexStore } from "./convex";
import type { ConvexClientLike } from "./convex";

interface FakeCall {
  op: "query" | "mutation";
  args: unknown;
}

function fakeClient() {
  const calls: FakeCall[] = [];
  const client = {
    query: vi.fn(async (_name: unknown, args: unknown) => {
      calls.push({ op: "query", args });
      return null;
    }),
    mutation: vi.fn(async (_name: unknown, args: unknown) => {
      calls.push({ op: "mutation", args });
      return "ID";
    }),
  };
  return { calls, client };
}

describe("ConvexStore", () => {
  test("getRun forwards entity_ref", async () => {
    const { calls, client } = fakeClient();
    // The store accepts the minimal interface { query, mutation }; cast at the boundary.
    const store = createConvexStore(client as unknown as ConvexClientLike);
    await store.getRun("todoist:task:abc");
    expect(calls[0].op).toBe("query");
    expect(calls[0].args).toEqual({ entity_ref: "todoist:task:abc" });
  });

  test("upsertRun forwards args verbatim", async () => {
    const { calls, client } = fakeClient();
    const store = createConvexStore(client as unknown as ConvexClientLike);
    await store.upsertRun({
      entity_ref: "todoist:task:abc",
      entity_type: "todoist_task",
      entity_id: "abc",
      backend: "claude_sdk",
      status: "discovering",
      run_id: "01H1",
      traceparent: null,
      resume_cursor: null,
    });
    expect(calls[0].op).toBe("mutation");
    expect(calls[0].args).toMatchObject({ run_id: "01H1" });
  });

  test("appendThreadMessage returns id", async () => {
    const { client } = fakeClient();
    const store = createConvexStore(client as unknown as ConvexClientLike);
    const id = await store.appendThreadMessage({
      entity_ref: "todoist:task:abc",
      run_id: "01H1",
      kind: "user_message",
      body_markdown: "hi",
      proposal_json: null,
      error_json: null,
      token_usage: null,
      checkpoint_id: null,
    });
    expect(id).toBe("ID");
  });

  test("startActivity + resolveActivity", async () => {
    const { calls, client } = fakeClient();
    const store = createConvexStore(client as unknown as ConvexClientLike);
    await store.startActivity({
      entity_ref: "e",
      run_id: "r",
      kind: "tool_call",
      name: "Read",
      input_json: {},
    });
    await store.resolveActivity({ id: "ID", status: "ok", output_json: null });
    expect(calls).toHaveLength(2);
    expect(calls[0].op).toBe("mutation");
    expect(calls[1].op).toBe("mutation");
  });
});
