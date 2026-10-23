import { mostUrgent } from "@shared/agent-attention";
import { useQuery } from "convex/react";
import type { GenericId } from "convex/values";

import { useAiStatus } from "@/hooks/use-ai";
import { agentApi, type AgentChatSummary, type AgentItem } from "@/lib/agent-api";
import { useAgentSettings } from "@/lib/settings";

const NO_ITEMS: readonly AgentItem[] = [];

/** The pane, ⌘J and the strip exist only while the Mini's runner is up and the setting is on. */
export function useAgentEnabled(): boolean {
  const { agentPane } = useAgentSettings();
  const { agentAvailable } = useAiStatus();
  return agentPane && agentAvailable;
}

/**
 * The conversation's most urgent open chat and its items. `chat` is undefined while loading, null
 * when no chat is open.
 */
export function useAgentChat(conversationId: GenericId<"comma_conversations"> | null, enabled = true): {
  chat: AgentChatSummary | null | undefined;
  items: readonly AgentItem[];
} {
  const chats = useQuery(agentApi.chatsFor, enabled && conversationId ? { conversationId } : "skip");
  const chat = chats && (mostUrgent(chats) ?? null);
  const items = useQuery(agentApi.listItems, chat ? { chatId: chat._id } : "skip");
  return { chat, items: chat ? items ?? NO_ITEMS : NO_ITEMS };
}
