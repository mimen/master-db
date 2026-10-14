import type { ChatSummary } from "@shared/types";
import { useQuery } from "convex/react";
import type { GenericId } from "convex/values";
import { createContext, useContext } from "react";
import { commaApi } from "@/lib/convex-api";

/** The one conversation-list subscription, published by ChatDirectoryProvider in use-chats. */
export const ChatDirectoryContext = createContext<ChatSummary[] | null>(null);

export function useChatDirectory(): ChatSummary[] | null {
  return useContext(ChatDirectoryContext);
}

/**
 * The conversation id and newest-message time for a chat, from the directory when it has the
 * chat, so a thread's message queries start on the click instead of after a resolveChat round
 * trip. Falls back to resolveChat for chats outside the directory (deep links, new chats).
 */
export function useConversationRef(chatGuid: string | null): {
  conversationId: GenericId<"comma_conversations"> | null;
  lastMessageAt: number | null;
  resolving: boolean;
} {
  const known = useChatDirectory()?.find((chat) => chat.guid === chatGuid);
  const knownId = known?.conversationId as GenericId<"comma_conversations"> | undefined;
  const resolved = useQuery(commaApi.resolveChat, chatGuid && !knownId ? { chatGuid } : "skip");
  if (knownId) return { conversationId: knownId, lastMessageAt: known?.lastMessage?.dateCreated ?? null, resolving: false };
  return {
    conversationId: resolved?._id ?? null,
    lastMessageAt: resolved?.lastMessage?.dateCreated ?? null,
    resolving: chatGuid !== null && resolved === undefined,
  };
}
