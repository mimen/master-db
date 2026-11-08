import { makeFunctionReference } from "convex/server";
import type { ObjectType } from "convex/values";
import type { AccountId, ConversationId, Platform } from "@shared/types";
import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import type { CommaExecutorStatus, presenceFields } from "../../../../../convex/schema/comma/validators";
import { runCommand } from "./convex-commands";

export type ExecutorStatus = CommaExecutorStatus;
export type PeerPresence = Omit<ObjectType<typeof presenceFields>, "conversationId">;
export const presenceApi = {
  presence: makeFunctionReference<"query", { conversationId: ConversationId }, PeerPresence | null>("comma/presence:presence"),
  routeStatus: makeFunctionReference<"query", { platform: Platform; accountId: AccountId | null }, ExecutorStatus | null>("comma/bridgeState:routeExecutorStatus"),
};

export async function setTyping(conversationId: ConversationId, active: boolean): Promise<void> {
  await runCommand(conversationId, { kind: "typing", active, expiresAt: Date.now() + 5000 });
}

/**
 * The status of the executor that runs this route's commands: undefined while loading, null before it first reports.
 * A route without an account reads its platform's only account's.
 */
export function useRouteStatus(route: { platform: Platform; accountId?: AccountId | null } | null | undefined): ExecutorStatus | null | undefined {
  const { isAuthenticated } = useConvexAuth();
  return useQuery(presenceApi.routeStatus, isAuthenticated && route ? { platform: route.platform, accountId: route.accountId ?? null } : "skip");
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

export function usePeerTyping(conversationId: ConversationId | null): boolean {
  const { isAuthenticated } = useConvexAuth();
  const presence = useQuery(presenceApi.presence, isAuthenticated && conversationId ? { conversationId } : "skip");
  return usePeerTypingValue(presence);
}
