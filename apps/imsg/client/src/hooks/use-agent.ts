import { useQuery } from "convex/react";
import type { GenericId } from "convex/values";
import { useEffect, useReducer } from "react";

import { useAiStatus } from "@/hooks/use-ai";
import { AGENT_FRESH_MS, agentApi, agentAvailable, type AgentChat, type AgentItem } from "@/lib/agent-api";
import { useAgentSettings } from "@/lib/settings";

const NO_ITEMS: readonly AgentItem[] = [];

/**
 * Convex never reruns aiStatus as time passes, so one timeout rerenders at the heartbeat's
 * deadline; a new heartbeat re-arms it. `watch` false skips the clock and reports unavailable.
 */
export function useAgentAvailable(watch = true): boolean {
  const heartbeatAt = useAiStatus()?.agentHeartbeatAt;
  const [, expire] = useReducer((ticks: number) => ticks + 1, 0);
  const available = watch && agentAvailable(heartbeatAt, Date.now());
  useEffect(() => {
    if (!available || heartbeatAt == null) return;
    const timer = setTimeout(expire, heartbeatAt + AGENT_FRESH_MS - Date.now() + 1);
    return () => clearTimeout(timer);
  }, [available, heartbeatAt]);
  return available;
}

/** The pane, ⌘J and the strip exist only while the Mini's runner is up and the setting is on. */
export function useAgentEnabled(): boolean {
  const { agentPane } = useAgentSettings();
  return useAgentAvailable(agentPane);
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
