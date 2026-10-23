import { mostUrgent } from "@shared/agent-attention";
import { useConvex } from "convex/react";
import { useEffect, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import { AppState, Platform } from "react-native";

import { useLayoutMode } from "@/hooks/use-layout-mode";
import { agentApi, type AgentChatId, type AgentChatSummary } from "@/lib/agent-api";
import type { PaneSelection } from "@/lib/agent-chats";
import { onOpenAgentPane, takeRequestedAgentChat } from "@/lib/agent-pane";

const requestedChat = (chatId: string | undefined): PaneSelection | undefined =>
  chatId ? { kind: "chat", chatId: chatId as AgentChatId } : undefined;

/**
 * Which chat the pane shows: the one requested (the phone route's param, the shell's request on
 * mount, or an openAgentPane while open), else the most urgent open chat once the list loads,
 * else a new chat. Once decided it holds, so a chat that stops being the most urgent stays in view.
 */
export function usePaneSelection(
  chatGuid: string,
  requested: string | undefined,
  chats: readonly AgentChatSummary[] | undefined,
): readonly [PaneSelection | undefined, Dispatch<SetStateAction<PaneSelection | undefined>>] {
  const [chosen, setChosen] = useState(() => requestedChat(requested ?? takeRequestedAgentChat(chatGuid)));
  // Only the wide shell's pane listens: on a phone, openAgentPane pushes the route because nothing does.
  const { wide } = useLayoutMode();
  useEffect(() => {
    if (!wide) return;
    return onOpenAgentPane(() => {
      const next = requestedChat(takeRequestedAgentChat(chatGuid));
      if (next) setChosen(next);
    });
  }, [chatGuid, wide]);
  if (chosen === undefined && chats !== undefined) {
    const urgent = mostUrgent(chats);
    const decided: PaneSelection = urgent ? { kind: "chat", chatId: urgent._id } : { kind: "new" };
    setChosen(decided);
    return [decided, setChosen];
  }
  return [chosen, setChosen];
}

function windowWatched(): boolean {
  if (Platform.OS !== "web") return AppState.currentState === "active";
  return document.visibilityState === "visible" && document.hasFocus();
}

function subscribeWatched(onChange: () => void): () => void {
  if (Platform.OS !== "web") {
    const subscription = AppState.addEventListener("change", onChange);
    return () => subscription.remove();
  }
  window.addEventListener("focus", onChange);
  window.addEventListener("blur", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.removeEventListener("focus", onChange);
    window.removeEventListener("blur", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

/** Marks the shown chat seen whenever a turn has ended since the last look and the window has the user's eyes. */
export function useMarkSeen(chat: AgentChatSummary | undefined): void {
  const convex = useConvex();
  const watched = useSyncExternalStore(subscribeWatched, windowWatched);
  const chatId = chat?._id;
  const unseen = chat !== undefined && (chat.lastTurnEndedAt ?? 0) > (chat.seenAt ?? 0);
  useEffect(() => {
    // A failed mark leaves the chat ready; the next finished turn or regained focus tries again.
    if (watched && unseen && chatId) convex.mutation(agentApi.markSeen, { chatId }).catch(() => undefined);
  }, [watched, unseen, chatId, convex]);
}
