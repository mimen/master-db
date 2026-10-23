import type { AgentChatState, AgentItem } from "./agent-api";

export type AgentStripState = "asking" | "working" | "drafted";

/** What the state strip says about the agent while its pane is closed. Only the latest turn counts. */
export function agentStripState(chat: { readonly state: AgentChatState } | null | undefined, items: readonly AgentItem[]): AgentStripState | null {
  if (!chat) return null;
  if (chat.state === "waiting_input") return "asking";
  if (chat.state === "running" || chat.state === "pending") return "working";
  const lastAsk = items.findLastIndex((item) => item.entry.kind === "user");
  const drafted = items.slice(lastAsk + 1).some((item) => item.entry.kind === "draft" && !item.entry.used);
  return drafted ? "drafted" : null;
}
