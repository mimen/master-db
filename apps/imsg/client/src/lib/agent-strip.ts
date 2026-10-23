import { agentAttention, type AttentionInput } from "@shared/agent-attention";

import type { AgentChatSummary } from "./agent-api";

export type AgentStripState = "asking" | "working" | "drafted" | "replied" | "failed";

/** What the state strip says, while the pane is closed, about the conversation's most urgent open chat. An open chat says nothing. */
export function agentStripState(chat: (AttentionInput & Pick<AgentChatSummary, "preview">) | undefined): AgentStripState | null {
  if (!chat) return null;
  switch (agentAttention(chat)) {
    case "needs_you": return "asking";
    case "working": return "working";
    case "ready": return chat.preview?.kind === "draft" ? "drafted" : "replied";
    case "failed": return "failed";
    case "open":
    case "settled": return null;
  }
}
