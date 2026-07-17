import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ChatSummary, StateCounts, StateFilter, TypeFilter } from "@/lib/types";

interface UseChatsResult {
  chats: ChatSummary[];
  counts: StateCounts | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useChats(state: StateFilter, type: TypeFilter): UseChatsResult {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [counts, setCounts] = useState<StateCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const refresh = useCallback(() => {
    const gen = ++generation.current;
    Promise.all([api.chats(state, type), api.counts(type)])
      .then(([result, stateCounts]) => {
        if (generation.current !== gen) return;
        setChats(result);
        setCounts(stateCounts);
        setError(null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (generation.current !== gen) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, [state, type]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  return { chats, counts, loading, error, refresh };
}
