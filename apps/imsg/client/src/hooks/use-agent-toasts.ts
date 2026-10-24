import type { AgentAttention } from "@shared/agent-attention";
import type { ChatSummary } from "@shared/types";
import { useQuery } from "convex/react";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";

import { agentApi } from "@/lib/agent-api";
import { openAgentPane, shownAgentChat } from "@/lib/agent-pane";
import { AGENT_ATTENTION, agentArrivals } from "@/lib/inbox-model";
import { selectChat } from "@/lib/selection";
import { useAgentSettings } from "@/lib/settings";
import { showToast } from "@/lib/toast";
import { useChatDirectory } from "./use-chat-directory";

/** Opens the conversation with its agent pane on `chatId`: a toast's Open and an Agent chats pick in ⌘K. */
export function openAgentChat(chat: Pick<ChatSummary, "guid" | "displayName">, chatId: string): void {
  if (!selectChat({ guid: chat.guid, name: chat.displayName })) {
    router.push({ pathname: "/chat/[guid]", params: { guid: chat.guid, name: chat.displayName } });
  }
  openAgentPane(chat.guid, chatId);
}

/**
 * Web and the desktop shell toast an agent chat that wants the user, unless it is the chat the open
 * pane shows. `lookingAt` is the conversation whose agent pane is open and selected.
 */
export function useAgentToasts(lookingAt: string | null): void {
  const { agentPane } = useAgentSettings();
  // Convex shares this subscription with the directory's own.
  const summaries = useQuery(agentApi.listAgentChats, Platform.OS === "web" && agentPane ? {} : "skip");
  const directory = useChatDirectory();
  const latest = useRef({ directory, lookingAt });
  useEffect(() => {
    latest.current = { directory, lookingAt };
  });
  const before = useRef<ReadonlyMap<string, AgentAttention> | null>(null);
  useEffect(() => {
    if (!summaries) {
      before.current = null;
      return;
    }
    const { arrivals, seen } = agentArrivals(before.current, summaries);
    before.current = seen;
    for (const { chat, attention } of arrivals) {
      const row = latest.current.directory?.find((c) => c.conversationId === chat.conversationId);
      if (!row || (row.guid === latest.current.lookingAt && chat._id === shownAgentChat())) continue;
      showToast(`${row.displayName} · ${AGENT_ATTENTION[attention].spoken}`, { label: "Open", onPress: () => openAgentChat(row, chat._id) });
    }
  }, [summaries]);
}
