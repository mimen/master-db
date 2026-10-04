import { makeFunctionReference } from "convex/server";
import { v, type GenericId, type Infer } from "convex/values";
import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { bridgeStateFields, presenceFields } from "../../../../../convex/schema/comma/validators";
import { commaApi } from "./convex-api";
import { runCommand } from "./convex-commands";

const bridgeStateValue = v.object(bridgeStateFields);
export type BridgeState = Infer<typeof bridgeStateValue>;
const presenceValue = v.object(presenceFields);
export type PeerPresence = Omit<Infer<typeof presenceValue>, "conversationId">;
export const presenceApi = {
  presence: makeFunctionReference<"query", { conversationId: GenericId<"comma_conversations"> }, PeerPresence | null>("comma/presence:presence"),
  bridgeState: makeFunctionReference<"query", Record<string, never>, BridgeState | null>("comma/bridgeState:bridgeState"),
};

export async function setTyping(chatGuid: string, active: boolean): Promise<void> {
  await runCommand(chatGuid, { kind: "typing", active, expiresAt: Date.now() + 5000 });
}

export function useBridgeState(): BridgeState | null | undefined {
  const { isAuthenticated } = useConvexAuth();
  return useQuery(presenceApi.bridgeState, isAuthenticated ? {} : "skip");
}

export function usePeerTypingValue(presence: PeerPresence | null | undefined): boolean {
  const [expiredAt, setExpiredAt] = useState<number | null>(null);
  const expiresAt = presence?.expiresAt;
  const peerTyping = presence?.peerTyping ?? false;
  useEffect(() => {
    if (!peerTyping || expiresAt === undefined) return;
    const timer = setTimeout(() => setExpiredAt(expiresAt), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [peerTyping, expiresAt]);
  return peerTyping && expiresAt !== undefined && expiresAt > Date.now() && expiredAt !== expiresAt;
}

export function usePeerTyping(chatGuid: string | null): boolean {
  const { isAuthenticated } = useConvexAuth();
  const conversation = useQuery(commaApi.resolveChat, isAuthenticated && chatGuid ? { chatGuid } : "skip");
  const presence = useQuery(presenceApi.presence, conversation ? { conversationId: conversation._id } : "skip");
  return usePeerTypingValue(presence);
}
