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

  // Filter views are FROZEN for triage consistency: once a chat appears in an
  // active state filter (Unread, Unresponded…), acting on it (reading,
  // replying) must not evict it mid-session. Membership accumulates while the
  // filter is active and resets when the state filter changes. Chats that
  // leave the "all" universe entirely (archived) still drop out — an explicit
  // archive should remove the row.
  const frozenRef = useRef<{ state: StateFilter; guids: Set<string> }>({
    state,
    guids: new Set(),
  });
  const chats = useMemo(() => {
    if (state === "all") {
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
  }, [all, state, type]);
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
