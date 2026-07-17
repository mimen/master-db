import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { computeCounts, matchesFilters } from "@/lib/filters";
import type { ChatSummary, StateCounts, StateFilter, TypeFilter } from "@/lib/types";

// Module-level cache: the full unfiltered list survives remounts, so
// navigation and filter changes render instantly from memory.
let fullCache: ChatSummary[] | null = null;

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
  const [all, setAll] = useState<ChatSummary[]>(fullCache ?? []);
  const [loading, setLoading] = useState(fullCache === null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const refresh = useCallback(() => {
    const gen = ++generation.current;
    api
      .allChats()
      .then((result) => {
        if (generation.current !== gen) return;
        fullCache = result;
        setAll(result);
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
    refresh();
  }, [refresh]);

  const chats = useMemo(() => all.filter((c) => matchesFilters(c, state, type)), [all, state, type]);
  const counts = useMemo(() => computeCounts(all, type), [all, type]);

  return { chats, counts, loading, error, refresh };
}
