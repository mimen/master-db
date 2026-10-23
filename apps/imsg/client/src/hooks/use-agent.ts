import { useQuery } from "convex/react";
import type { GenericId } from "convex/values";

import { useAiStatus } from "@/hooks/use-ai";
import { agentApi, type AgentChatId, type AgentChatSummary, type AgentItem } from "@/lib/agent-api";
import { useAgentSettings } from "@/lib/settings";

const NO_ITEMS: readonly AgentItem[] = [];

/** The pane, ⌘J and the strip exist only while the Mini's runner is up and the setting is on. */
export function useAgentEnabled(): boolean {
  const { agentPane } = useAgentSettings();
  const { agentAvailable } = useAiStatus();
  return agentPane && agentAvailable;
}

/** The conversation's chats, open and settled, newest first; undefined while loading. */
export function useAgentChats(conversationId: GenericId<"comma_conversations"> | null, enabled = true): readonly AgentChatSummary[] | undefined {
  return useQuery(agentApi.chatsFor, enabled && conversationId ? { conversationId } : "skip");
}

export function useAgentItems(chatId: AgentChatId | undefined): readonly AgentItem[] {
  return useQuery(agentApi.listItems, chatId ? { chatId } : "skip") ?? NO_ITEMS;
}
