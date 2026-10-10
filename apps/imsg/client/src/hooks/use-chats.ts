import { useConvexConnectionState, usePaginatedQuery } from "convex/react";
import { createElement, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Platform } from "react-native";
import { readChatSnapshot, webStore, writeChatSnapshot } from "@/lib/chat-snapshot";
import { conversationToChat } from "@/lib/convex-adapters";
import { commaApi } from "@/lib/convex-api";
import { computeCounts, matchesFilters } from "@shared/chat-state";
import type { ChatSummary, StateCounts, StateFilter, TypeFilter } from "@shared/types";
import { ChatDirectoryContext, useChatDirectory } from "./use-chat-directory";

interface UseChatsResult {
  chats: ChatSummary[];
  /** The unfiltered universe — search-mode input. */
  allChats: ChatSummary[];
  counts: StateCounts | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Every conversation from Convex, live. Pages load one after another until the list is complete.
 * Only ChatDirectoryProvider calls this; everything else reads useChatDirectory.
 */
export function useConvexChats(): { chats: ChatSummary[] | null } {
  // A new message re-runs the page holding its conversation, and the busiest conversations sit
  // in the first page. At 200 rows that re-run took 1-4.5s server-side before the sidebar moved.
  const { results, status, loadMore } = usePaginatedQuery(
    commaApi.listConversations,
    {},
    { initialNumItems: 25 },
  );
  useEffect(() => {
    if (status === "CanLoadMore") loadMore(100);
  }, [status, loadMore]);
  const chats = useMemo(() => results.map(conversationToChat), [results]);
  const live = status !== "LoadingFirstPage";
  // Read once per mount: the snapshot only bridges the gap until the first live page.
  const [snapshot] = useState(() => readChatSnapshot(webStore()));
  useEffect(() => {
    if (status === "Exhausted") writeChatSnapshot(webStore(), chats);
  }, [status, chats]);
  return { chats: live ? chats : snapshot };
}

/**
 * Owns the app's one listConversations subscription. Each paginated query carries its own id,
 * so every hook that subscribed separately re-read all ~1,000 conversations, and a thread open
 * that mounted another held the thread's first query behind a second-long list page.
 */
export function ChatDirectoryProvider({ children }: { readonly children: ReactNode }) {
  const { chats } = useConvexChats();
  return createElement(ChatDirectoryContext.Provider, { value: chats }, children);
}

/**
 * Fetches the complete chat list once and filters locally — filter/lens
 * switches are pure computation, no network.
 */
export function useChats(state: StateFilter, type: TypeFilter, freezeMembership = true, held: string | null = null): UseChatsResult {
  const directory = useChatDirectory();
  const all = useMemo(() => directory ?? [], [directory]);
  const loading = directory === null;
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
      return all.filter((c) => c.guid === held || matchesFilters(c, state, type));
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
  }, [all, state, type, freezeMembership, held]);
  // Unknown, not zero, until the first list arrives: a zero would paint and then jump.
  const counts = useMemo(() => (directory === null ? null : computeCounts(all, type)), [directory, all, type]);

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
