import { useConvexConnectionState, usePaginatedQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Platform } from "react-native";
import { conversationToChat } from "@/lib/convex-adapters";
import { commaApi } from "@/lib/convex-api";
import { computeCounts, matchesFilters } from "@shared/chat-state";
import type { ChatSummary, StateCounts, StateFilter, TypeFilter } from "@shared/types";

interface UseChatsResult {
  chats: ChatSummary[];
  /** The unfiltered universe — search-mode input. */
  allChats: ChatSummary[];
  counts: StateCounts | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/** Every conversation from Convex, live. Pages load one after another until the list is complete. */
export function useConvexChats(): { chats: ChatSummary[] | null } {
  const { results, status, loadMore } = usePaginatedQuery(
    commaApi.listConversations,
    {},
    { initialNumItems: 200 },
  );
  useEffect(() => {
    if (status === "CanLoadMore") loadMore(200);
  }, [status, loadMore]);
  const chats = useMemo(() => results.map(conversationToChat), [results]);
  return { chats: status !== "LoadingFirstPage" ? chats : null };
}

/**
 * Fetches the complete chat list once and filters locally — filter/lens
 * switches are pure computation, no network.
 */
export function useChats(state: StateFilter, type: TypeFilter, freezeMembership = true): UseChatsResult {
  const convex = useConvexChats();
  const all = convex.chats ?? [];
  const loading = convex.chats === null;
  const refresh = useCallback(() => undefined, []);
  // Convex reconnects on its own; this only surfaces the outage it is already riding out.
  // Its socket takes about a minute to notice a dead network, so the browser's own signal leads.
  const { isWebSocketConnected, hasEverConnected } = useConvexConnectionState();
  const browserOnline = useBrowserOnline();
  const error = hasEverConnected && (!isWebSocketConnected || !browserOnline) ? "offline" : null;

  // Passive review lenses (Unread, Settled) freeze membership so an item does
  // not jump while it is being inspected. The active triage queues enumerated
  // below must not: replying and Settle are defined to clear Needs reply /
  // Waiting immediately.
  const frozenRef = useRef<{ state: StateFilter; guids: Set<string> }>({
    state,
    guids: new Set(),
  });
  const chats = useMemo(() => {
    if (state === "all" || state === "unresponded" || state === "waiting" || !freezeMembership) {
      frozenRef.current = { state, guids: new Set() };
      return all.filter((c) => matchesFilters(c, state, type));
    }
    if (frozenRef.current.state !== state) frozenRef.current = { state, guids: new Set() };
    const frozen = frozenRef.current.guids;
    return all.filter((c) => {
      if (matchesFilters(c, state, type)) {
        frozen.add(c.guid);
        return true;
      }
      return frozen.has(c.guid) && matchesFilters(c, "all", type);
    });
  }, [all, state, type, freezeMembership]);
  const counts = useMemo(() => computeCounts(all, type), [all, type]);

  // Dock/home-screen unread badge (Safari web apps + installed PWAs).
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const nav = navigator as Navigator & {
      setAppBadge?: (n: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (!nav.setAppBadge) return;
    // "known", not "all": the dock badge must never count junk or messages
    // from unrecognised numbers, and "all" now includes both.
    const unread = all.filter((c) => matchesFilters(c, "unread", "known")).length;
    if (unread > 0) void nav.setAppBadge(unread).catch(() => undefined);
    else void nav.clearAppBadge?.().catch(() => undefined);
  }, [all]);

  return { chats, allChats: all, counts, loading, error, refresh };
}

function subscribeOnline(onChange: () => void): () => void {
  if (Platform.OS !== "web" || typeof window === "undefined") return () => undefined;
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function useBrowserOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => Platform.OS !== "web" || typeof navigator === "undefined" || navigator.onLine,
    () => true,
  );
}
