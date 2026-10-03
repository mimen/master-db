import type { ChatSummary } from "@shared/types";
import { useConvexChats } from "./use-chats";

export function useChatDirectory(): readonly ChatSummary[] | null {
  return useConvexChats().chats;
}
