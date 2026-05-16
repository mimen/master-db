import type { ThreadMessageLike } from "@assistant-ui/react"

export type ThreadRow = {
  _id: string
  row_type: "message" | "activity"
  sequence: number
  run_id: string
  kind: string
  body_markdown?: string | null
  proposal_json?: unknown
  error_json?: unknown
  token_usage?: unknown
  checkpoint_id?: string | null
  name?: string
  input_json?: unknown
  output_json?: unknown
  status?: string
  resolved_at?: number | null
}

export function convertMessage(row: ThreadRow): ThreadMessageLike {
  if (row.row_type === "message") {
    switch (row.kind) {
      case "user_message":
        return { id: row._id, role: "user",
          content: [{ type: "text", text: row.body_markdown ?? "" }] }
      case "assistant_message":
        return { id: row._id, role: "assistant",
          content: [{ type: "text", text: row.body_markdown ?? "" }] }
      case "proposal":
        return { id: row._id, role: "assistant",
          content: [{ type: "data-proposal", data: row.proposal_json } as never] }
      case "execution_result":
        return { id: row._id, role: "assistant",
          content: [{ type: "data-execution-result",
            data: { body_markdown: row.body_markdown ?? "" } } as never] }
      case "error":
        return { id: row._id, role: "assistant",
          content: [{ type: "data-error", data: row.error_json } as never] }
      case "reasoning":
        return { id: row._id, role: "assistant",
          content: [{ type: "data-reasoning",
            data: { body_markdown: row.body_markdown ?? "" } } as never] }
    }
  }
  if (row.row_type === "activity" && row.kind === "tool_call") {
    return { id: row._id, role: "assistant",
      content: [{ type: "data-tool-call",
        data: {
          name: row.name ?? "unknown",
          status: row.status ?? "pending",
          input: row.input_json,
          output: row.output_json,
        } } as never] }
  }
  return { id: row._id, role: "assistant",
    content: [{ type: "text", text: `[unhandled kind: ${row.kind}]` }] }
}
