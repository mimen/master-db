import type { ChatSummary } from "@shared/types";
import type { GenericId } from "convex/values";
import { createContext, useContext } from "react";
import { commaApi } from "@/lib/convex-api";
import { useRetryingQuery } from "@/lib/retrying-query";

/** The one conversation-list subscription, published by ChatDirectoryProvider in use-chats. */
export const ChatDirectoryContext = createContext<ChatSummary[] | null>(null);
/** True while the directory's list query is failing; the directory is its last good rows. */
export const DirectoryFailedContext = createContext(false);

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
  const { data: resolved } = useRetryingQuery(commaApi.resolveChat, chatGuid && !knownId ? { chatGuid } : "skip");
  if (knownId) return { conversationId: knownId, lastMessageAt: known?.lastMessage?.dateCreated ?? null, resolving: false };
  return {
    conversationId: resolved?._id ?? null,
    lastMessageAt: resolved?.lastMessage?.dateCreated ?? null,
    resolving: chatGuid !== null && resolved === undefined,
  };
}
