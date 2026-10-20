import { useQuery } from "convex/react";
import { createContext, createElement, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import { AGENT_FRESH_MS, agentAvailable as isFresh } from "@/lib/agent-api";
import { aiApi } from "@/lib/ai-api";

/** What the Mini can do right now. */
export interface AiCapabilities {
  readonly suggestions: boolean;
  readonly reactionSuggestions: boolean;
  readonly agentAvailable: boolean;
}

const UNREACHABLE: AiCapabilities = { suggestions: false, reactionSuggestions: false, agentAvailable: false };
const AiStatusContext = createContext<AiCapabilities>(UNREACHABLE);

/**
 * The one aiStatus subscription. The runner's heartbeat lands here and stops here: readers see a
 * new value only when a capability flips, so the thread and composer do not rerender per beat.
 * Convex never reruns aiStatus as time passes, so one timeout rerenders at the heartbeat's deadline.
 */
export function AiStatusProvider({ children }: { readonly children: ReactNode }) {
  const status = useQuery(aiApi.aiStatus, {});
  const heartbeatAt = status?.agentHeartbeatAt ?? null;
  const [, expire] = useReducer((ticks: number) => ticks + 1, 0);
  const agentAvailable = isFresh(heartbeatAt, Date.now());
  useEffect(() => {
    if (!agentAvailable || heartbeatAt == null) return;
    const timer = setTimeout(expire, heartbeatAt + AGENT_FRESH_MS - Date.now() + 1);
    return () => clearTimeout(timer);
  }, [agentAvailable, heartbeatAt]);
  const suggestions = status?.suggestions ?? false;
  const reactionSuggestions = status?.reactionSuggestions ?? false;
  const value = useMemo(
    () => ({ suggestions, reactionSuggestions, agentAvailable }),
    [suggestions, reactionSuggestions, agentAvailable],
  );
  return createElement(AiStatusContext.Provider, { value }, children);
}

/** Mini capability published by the presence bridge and the agent runner's heartbeat. */
export function useAiStatus(): AiCapabilities {
  return useContext(AiStatusContext);
}
