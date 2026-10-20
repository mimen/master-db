import { useQuery } from "convex/react";
import type { GenericId } from "convex/values";

import { useAiStatus } from "@/hooks/use-ai";
import { agentApi, type AgentChat, type AgentItem } from "@/lib/agent-api";
import { useAgentSettings } from "@/lib/settings";

const NO_ITEMS: readonly AgentItem[] = [];

/** The pane, ⌘J and the strip exist only while the Mini's runner is up and the setting is on. */
export function useAgentEnabled(): boolean {
  const status = useAiStatus();
  const { agentPane } = useAgentSettings();
  return status?.agent === true && agentPane;
}

/** The conversation's live chat and its items. `chat` is undefined while loading, null when none exists yet. */
export function useAgentChat(conversationId: GenericId<"comma_conversations"> | null, enabled = true): {
  chat: AgentChat | null | undefined;
  items: readonly AgentItem[];
} {
  const chat = useQuery(agentApi.liveChat, enabled && conversationId ? { conversationId } : "skip");
  const items = useQuery(agentApi.listItems, chat ? { chatId: chat._id } : "skip");
  return { chat, items: chat ? items ?? NO_ITEMS : NO_ITEMS };
}
