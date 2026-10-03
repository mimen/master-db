import { usePaginatedQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { api } from "@/lib/api";
import { getChats, mutationEpochNow, setChats, subscribeChats } from "@/lib/chat-store";
import { conversationToChat } from "@/lib/convex-adapters";
import { commaApi } from "@/lib/convex-api";
import { useDataSource } from "@/lib/settings";
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
function useConvexChats(enabled: boolean): { chats: ChatSummary[] | null } {
  const { results, status, loadMore } = usePaginatedQuery(
    commaApi.listConversations,
    enabled ? {} : "skip",
    { initialNumItems: 200 },
  );
  useEffect(() => {
    if (enabled && status === "CanLoadMore") loadMore(200);
  }, [enabled, status, loadMore]);
  const chats = useMemo(() => results.map(conversationToChat), [results]);
  return { chats: enabled && status !== "LoadingFirstPage" ? chats : null };
}

/**
 * Fetches the complete chat list once and filters locally — filter/lens
 * switches are pure computation, no network.
 */
export function useChats(state: StateFilter, type: TypeFilter, freezeMembership = true): UseChatsResult {
  const convexMode = useDataSource() === "convex";
  const convex = useConvexChats(convexMode);
  const [serverAll, setAll] = useState<ChatSummary[]>(getChats() ?? []);
  const [serverLoading, setLoading] = useState(getChats() === null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const all = convexMode ? (convex.chats ?? []) : serverAll;
  const loading = convexMode ? convex.chats === null : serverLoading;

  const refresh = useCallback(() => {
    const gen = ++generation.current;
    const epoch = mutationEpochNow();
    api
      .allChats()
      .then((result) => {
        if (generation.current !== gen) return;
        setChats(result, epoch);
        setError(null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (generation.current !== gen) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeChats(setAll);
    refresh();
    return unsubscribe;
  }, [refresh]);

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
