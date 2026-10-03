import type { ChatSummary } from "@shared/types";
import { useEffect, useSyncExternalStore } from "react";

import { api } from "@/lib/api";
import { getChats, mutationEpochNow, setChats, subscribeChats } from "@/lib/chat-store";
import { useDataSource } from "@/lib/settings";
import { useConvexChats } from "./use-chats";

/**
 * The shared chat list for panes that can open without the inbox mounted (a
 * phone deep link to /person or /chat-info). The inbox normally fills the
 * store; when nothing has, this fetches it once so every surface derives from
 * the same summaries.
 */
export function useChatDirectory(): readonly ChatSummary[] | null {
  const convexMode = useDataSource() === "convex";
  const convex = useConvexChats(convexMode);
  const chats = useSyncExternalStore(subscribeChats, getChats, getChats);
  useEffect(() => {
    if (convexMode || getChats() !== null) return;
    const epoch = mutationEpochNow();
    api.allChats().then((result) => setChats(result, epoch), () => undefined);
  }, [convexMode]);
  return convexMode ? convex.chats : chats;
}
