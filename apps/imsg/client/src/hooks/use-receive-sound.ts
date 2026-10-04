import { useConvexConnectionState } from "convex/react";
import { useEffect, useRef } from "react";
import type { ChatSummary } from "@shared/types";
import { createReceiveSoundObserver } from "@/lib/message-observers";

export function useReceiveSound(chats: readonly ChatSummary[] | null, play: () => void): void {
  const { isWebSocketConnected } = useConvexConnectionState();
  const observer = useRef(createReceiveSoundObserver());
  const wasConnected = useRef(isWebSocketConnected);
  useEffect(() => {
    const now = Date.now();
    if (wasConnected.current !== isWebSocketConnected) observer.current.reconnect(now);
    wasConnected.current = isWebSocketConnected;
    for (const _guid of observer.current.observe(chats, now, isWebSocketConnected)) play();
  }, [chats, isWebSocketConnected, play]);
}
