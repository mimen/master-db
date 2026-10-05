import type { ChatSummary } from "@shared/types";
import { createContext, useContext, type ReactNode } from "react";
import { useConvexChats } from "./use-chats";

const ChatDirectoryContext = createContext<ChatSummary[] | null | undefined>(undefined);

/**
 * The one conversation-list subscription. Every paginated query carries its own id, so each
 * hook that subscribed separately re-read all ~1,000 conversations, and a thread open that
 * mounted another one held the thread's first query behind a second-long list page.
 */
export function ChatDirectoryProvider({ children }: { readonly children: ReactNode }) {
  const { chats } = useConvexChats();
  return <ChatDirectoryContext.Provider value={chats}>{children}</ChatDirectoryContext.Provider>;
}

export function useChatDirectory(): ChatSummary[] | null {
  const chats = useContext(ChatDirectoryContext);
  if (chats === undefined) throw new Error("useChatDirectory must render inside ChatDirectoryProvider");
  return chats;
}
