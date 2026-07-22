import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { api } from "@/lib/api";
import { getChats, setChats, subscribeChats } from "@/lib/chat-store";
import { computeCounts, matchesFilters } from "@shared/chat-state";
import type { ChatSummary, StateCounts, StateFilter, TypeFilter } from "@shared/types";

interface UseChatsResult {
  chats: ChatSummary[];
  counts: StateCounts | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Fetches the complete chat list once and filters locally — filter/lens
 * switches are pure computation, no network.
 */
export function useChats(state: StateFilter, type: TypeFilter): UseChatsResult {
  const [all, setAll] = useState<ChatSummary[]>(getChats() ?? []);
  const [loading, setLoading] = useState(getChats() === null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const refresh = useCallback(() => {
    const gen = ++generation.current;
    api
      .allChats()
      .then((result) => {
        if (generation.current !== gen) return;
        setChats(result);
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

  const chats = useMemo(() => all.filter((c) => matchesFilters(c, state, type)), [all, state, type]);
  const counts = useMemo(() => computeCounts(all, type), [all, type]);

  // Dock/home-screen unread badge (Safari web apps + installed PWAs).
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const nav = navigator as Navigator & {
      setAppBadge?: (n: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (!nav.setAppBadge) return;
    const unread = all.filter((c) => matchesFilters(c, "unread", "all")).length;
    if (unread > 0) void nav.setAppBadge(unread).catch(() => undefined);
    else void nav.clearAppBadge?.().catch(() => undefined);
  }, [all]);

  return { chats, counts, loading, error, refresh };
}
