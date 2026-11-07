import type { ChatSummary, ConversationId } from "@shared/types";
import { useQuery } from "convex/react";
import { createContext, useContext, useMemo } from "react";
import { conversationToChat } from "@/lib/convex-adapters";
import { commaApi } from "@/lib/convex-api";

/** The one conversation-list subscription, published by ChatDirectoryProvider in use-chats. */
export const ChatDirectoryContext = createContext<ChatSummary[] | null>(null);

export function useChatDirectory(): ChatSummary[] | null {
  return useContext(ChatDirectoryContext);
}

/**
 * A conversation from the directory when it lists it, so a thread's queries start on the click.
 * One the directory has not loaded or does not list (a deep link, a new chat) comes from its own
 * query: undefined while it loads, null when no such conversation exists.
 */
export function useConversation(conversationId: ConversationId | null): ChatSummary | null | undefined {
  const known = useChatDirectory()?.find((chat) => chat.conversationId === conversationId);
  const fetched = useQuery(commaApi.getConversation, conversationId && !known ? { conversationId } : "skip");
  const loaded = useMemo(() => fetched && conversationToChat(fetched), [fetched]);
  if (!conversationId) return null;
  return known ?? loaded;
}
