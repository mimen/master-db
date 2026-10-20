import { useQuery } from "convex/react";
import type { GenericId } from "convex/values";
import { useEffect, useState } from "react";

import { useAiStatus } from "@/hooks/use-ai";
import { agentApi, agentAvailable, type AgentChat, type AgentItem } from "@/lib/agent-api";
import { useAgentSettings } from "@/lib/settings";

const NO_ITEMS: readonly AgentItem[] = [];
const RECHECK_MS = 30_000;

/** Convex never reruns aiStatus as time passes, so the heartbeat's age is judged on this clock. */
export function useAgentAvailable(): boolean {
  const heartbeatAt = useAiStatus()?.agentHeartbeatAt;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), RECHECK_MS);
    return () => clearInterval(timer);
  }, []);
  return agentAvailable(heartbeatAt, now);
}

/** The pane, ⌘J and the strip exist only while the Mini's runner is up and the setting is on. */
export function useAgentEnabled(): boolean {
  const available = useAgentAvailable();
  const { agentPane } = useAgentSettings();
  return available && agentPane;
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
