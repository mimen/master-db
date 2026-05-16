import { describe, expect, test } from "vitest"

import { convertMessage, type ThreadRow } from "./convertMessage"

function row(over: Partial<ThreadRow>): ThreadRow {
  return {
    _id: "r1",
    row_type: "message",
    sequence: 1,
    run_id: "01H",
    kind: "user_message",
    body_markdown: "hi",
    proposal_json: null,
    error_json: null,
    token_usage: null,
    checkpoint_id: null,
    ...over,
  } as ThreadRow
}

describe("convertMessage", () => {
  test("user_message → user role, single text part", () => {
    const m = convertMessage(row({ kind: "user_message", body_markdown: "hello" }))
    expect(m.role).toBe("user")
    expect(m.content).toEqual([{ type: "text", text: "hello" }])
  })

  test("assistant_message → assistant role, single text part", () => {
    const m = convertMessage(row({ kind: "assistant_message", body_markdown: "world" }))
    expect(m.role).toBe("assistant")
    expect(m.content).toEqual([{ type: "text", text: "world" }])
  })

  test("proposal → assistant role, data-proposal part", () => {
    const p = { kind: "proposal", summary: "x", options: [], free_text_allowed: true }
    const m = convertMessage(row({ kind: "proposal", body_markdown: null, proposal_json: p }))
    expect(m.role).toBe("assistant")
    expect(m.content[0]).toMatchObject({ type: "data-proposal", data: p })
  })

  test("execution_result → assistant role, data-execution-result part", () => {
    const m = convertMessage(row({ kind: "execution_result", body_markdown: "✓ done" }))
    expect(m.content[0]).toMatchObject({ type: "data-execution-result", data: { body_markdown: "✓ done" } })
  })

  test("error → assistant role, data-error part", () => {
    const errPayload = { message: "boom" }
    const m = convertMessage(row({ kind: "error", body_markdown: null, error_json: errPayload }))
    expect(m.content[0]).toMatchObject({ type: "data-error", data: errPayload })
  })

  test("reasoning → assistant role, data-reasoning part (will be grouped, not rendered alone)", () => {
    const m = convertMessage(row({ kind: "reasoning", body_markdown: "thinking…" }))
    expect(m.content[0]).toMatchObject({ type: "data-reasoning", data: { body_markdown: "thinking…" } })
  })

  test("activity tool_call → assistant role, data-tool-call part", () => {
    const m = convertMessage({
      _id: "a1", row_type: "activity", sequence: 5, run_id: "01H",
      kind: "tool_call", name: "search_obsidian",
      input_json: { q: "x" }, output_json: { hits: 2 }, status: "ok", resolved_at: null,
    } as ThreadRow)
    expect(m.content[0]).toMatchObject({
      type: "data-tool-call",
      data: { name: "search_obsidian", status: "ok", input: { q: "x" }, output: { hits: 2 } },
    })
  })

  test("body_markdown null on prose kinds → empty string text", () => {
    const m = convertMessage(row({ kind: "assistant_message", body_markdown: null }))
    expect(m.content[0]).toEqual({ type: "text", text: "" })
  })

  test("id is the Convex _id", () => {
    expect(convertMessage(row({ _id: "abc" })).id).toBe("abc")
  })
})
